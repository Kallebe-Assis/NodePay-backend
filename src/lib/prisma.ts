import { PrismaClient } from '@prisma/client';
import { env, isDbConfigured } from '../config/env.js';

/**
 * Cliente Prisma único. Só é instanciado se DATABASE_URL estiver preenchida;
 * caso contrário fica `null` e as rotas de domínio respondem 503.
 */
export const prisma: PrismaClient | null = isDbConfigured
  ? new PrismaClient({
      log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    })
  : null;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    throw Object.assign(new Error('DB_UNAVAILABLE'), { statusCode: 503, code: 'DB_UNAVAILABLE' });
  }
  return prisma;
}
