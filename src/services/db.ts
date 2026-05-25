import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// PrismaClient is attached to the `globalThis` object in development to prevent
// exhausting your database connection limit in Next.js hot reloading.
const prismaGlobal = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const getPrismaClient = (): PrismaClient => {
  if (!prismaGlobal.prisma) {
    const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    prismaGlobal.prisma = new PrismaClient({ adapter });
  }
  return prismaGlobal.prisma;
};

export const prisma = getPrismaClient();
export default prisma;
