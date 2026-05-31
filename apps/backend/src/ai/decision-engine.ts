// ============================================================
// AI Decision Engine (Gemini)
// ============================================================
// The crown jewel. Makes real infrastructure decisions using
// Google Gemini with structured JSON output. Validates responses
// against deterministic safeguards. Falls back to rule-based
// decisions when AI is unavailable or unreliable.
// ============================================================

import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import { env } from '../config/env.js';
import { createChildLogger } from '../telemetry/logger.js';
import { eventBus } from '../events/event-bus.js';
import { circuitBreakers } from '../retry/circuit-breaker.js';
import {
  EVENTS,
  AI_DECISION_TIMEOUT_MS,
  MAX_RETRY_ATTEMPTS,
  type AiDecisionContext,
  type AiDecisionResponse,
  type AiDecisionRecord,
  AiDecisionOutcome,
  type FailureCategory,
  generateId,
  withTimeout,
} from '@solstice/shared';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts.js';
import { AiDecisionResponseSchema, validateAiDecision } from './schema.js';
import { applyFallbackRules } from './fallback-rules.js';
import {
  aiDecisionCounter,
  aiConfidenceHistogram,
  aiLatencyHistogram,
} from '../telemetry/metrics.js';
import { prisma } from '../db/prisma-client.js';

const log = createChildLogger('ai-engine');

export class AiDecisionEngine {
  private model: GenerativeModel;
  private totalDecisions = 0;
  private fallbackCount = 0;

  constructor() {
    const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    this.model = genAI.getGenerativeModel({
      model: env.GEMINI_MODEL,
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: env.GEMINI_MAX_TOKENS,
        temperature: 0.2,
      },
    });

    log.info({ model: env.GEMINI_MODEL }, 'AI decision engine initialized');
  }

  /**
   * Request a decision from the AI engine. Falls back to deterministic
   * rules if Gemini is unavailable, returns invalid output, or the
   * circuit breaker is open.
   */
  async decide(
    transactionId: string,
    failureCategory: FailureCategory,
    context: AiDecisionContext,
  ): Promise<AiDecisionRecord> {
    const startTime = performance.now();
    this.totalDecisions++;

    eventBus.emit(EVENTS.AI_DECISION_REQUESTED, { transactionId });

    // Try AI first, fall back to rules on any failure
    let decision: AiDecisionResponse;
    let wasOverridden = false;
    let overrideReason: string | null = null;
    let modelUsed = env.GEMINI_MODEL;

    try {
      decision = await circuitBreakers.ai.execute(async () => {
        return await this.callGemini(context);
      });

      // Validate the AI response against safeguards
      const validation = validateAiDecision(
        decision,
        context.currentTipLamports,
        context.retryCount,
        MAX_RETRY_ATTEMPTS,
      );

      if (!validation.valid) {
        log.warn(
          { transactionId, reason: validation.reason },
          'AI decision failed validation — applying fallback',
        );
        wasOverridden = true;
        overrideReason = validation.reason;
        decision = applyFallbackRules(failureCategory, context);
        modelUsed = 'fallback-rules';
        this.fallbackCount++;
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      log.warn(
        { transactionId, error: errorMessage },
        'AI engine unavailable — applying fallback rules',
      );

      decision = applyFallbackRules(failureCategory, context);
      modelUsed = 'fallback-rules';
      wasOverridden = true;
      overrideReason = `AI unavailable: ${errorMessage}`;
      this.fallbackCount++;

      eventBus.emit(EVENTS.AI_DECISION_FALLBACK, {
        transactionId,
        reason: errorMessage,
      });
    }

    const latencyMs = performance.now() - startTime;

    // Track metrics
    aiLatencyHistogram.observe(latencyMs / 1000);
    aiConfidenceHistogram.observe(decision.confidence);

    if (decision.shouldRetry) aiDecisionCounter.labels('retry').inc();
    if (decision.abandonTransaction) aiDecisionCounter.labels('abandon').inc();
    if (decision.waitForJitoLeader) aiDecisionCounter.labels('wait_jito').inc();
    if (decision.splitBundle) aiDecisionCounter.labels('split_bundle').inc();
    if (decision.rebroadcast) aiDecisionCounter.labels('rebroadcast').inc();
    if (decision.newTipLamports !== null) aiDecisionCounter.labels('adjust_tip').inc();

    const record: AiDecisionRecord = {
      id: generateId('aid'),
      transactionId,
      context,
      decision,
      timestamp: Date.now(),
      modelUsed,
      latencyMs: Math.round(latencyMs),
      wasOverridden,
      overrideReason,
      outcome: AiDecisionOutcome.PENDING,
    };

    // Save AI decision to database in background
    prisma.aiDecision
      .create({
        data: {
          id: record.id,
          transactionId: record.transactionId,
          context: JSON.stringify(record.context),
          decision: JSON.stringify(record.decision),
          confidence: record.decision.confidence,
          reasoning: record.decision.reasoning,
          modelUsed: record.modelUsed,
          latencyMs: record.latencyMs,
          wasOverridden: record.wasOverridden,
          overrideReason: record.overrideReason,
          outcome: record.outcome ?? 'PENDING',
          timestamp: new Date(record.timestamp),
        },
      })
      .catch((err) =>
        log.error({ err: err.message }, 'failed to save AI decision to database')
      );

    eventBus.emit(EVENTS.AI_DECISION_RECEIVED, record);

    log.info(
      {
        transactionId,
        shouldRetry: decision.shouldRetry,
        confidence: decision.confidence,
        modelUsed,
        latencyMs: Math.round(latencyMs),
        wasOverridden,
      },
      'AI decision rendered',
    );

    return record;
  }

  private async callGemini(context: AiDecisionContext): Promise<AiDecisionResponse> {
    const userPrompt = buildUserPrompt(context);

    const result = await withTimeout(
      this.model.generateContent(SYSTEM_PROMPT + '\n\n' + userPrompt),
      AI_DECISION_TIMEOUT_MS,
      'Gemini API call',
    );

    const responseText = result.response.text();

    // Parse and validate the JSON response with Zod
    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      throw new Error(`Gemini returned non-JSON response: ${responseText.slice(0, 200)}`);
    }

    const validated = AiDecisionResponseSchema.safeParse(parsed);

    if (!validated.success) {
      const issues = validated.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new Error(`Gemini response failed schema validation: ${issues}`);
    }

    return validated.data;
  }

  /**
   * Get engine stats for observability.
   */
  getStats(): {
    totalDecisions: number;
    fallbackCount: number;
    fallbackRate: number;
    model: string;
    circuitBreakerState: string;
  } {
    return {
      totalDecisions: this.totalDecisions,
      fallbackCount: this.fallbackCount,
      fallbackRate:
        this.totalDecisions > 0
          ? this.fallbackCount / this.totalDecisions
          : 0,
      model: env.GEMINI_MODEL,
      circuitBreakerState: circuitBreakers.ai.getStatus().state,
    };
  }
}

export const aiDecisionEngine = new AiDecisionEngine();
