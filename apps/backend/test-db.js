import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  try {
    const txCount = await prisma.transaction.count();
    console.log('Transaction count:', txCount);
    const aiCount = await prisma.aiDecision.count();
    console.log('AI Decision count:', aiCount);
    
    if (txCount > 0) {
      const txs = await prisma.transaction.findMany({ take: 5 });
      console.log('Sample transactions:', txs);
    }
  } catch (error) {
    console.error('Prisma query failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
