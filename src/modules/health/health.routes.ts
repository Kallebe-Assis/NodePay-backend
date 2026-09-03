import type { FastifyInstance } from 'fastify';
import { isDbConfigured } from '../../config/env.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ status: 'ok', service: 'nodepay-api', time: new Date().toISOString() }));

  app.get('/ready', async (_req, reply) => {
    if (!app.prisma) {
      return reply.code(200).send({ status: 'degraded', db: 'not-configured', dbConfigured: isDbConfigured });
    }
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'up' };
    } catch {
      return reply.code(503).send({ status: 'error', db: 'down' });
    }
  });
}
