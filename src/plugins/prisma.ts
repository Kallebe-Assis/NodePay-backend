import fp from 'fastify-plugin';
import { prisma } from '../lib/prisma.js';
import { Errors } from '../lib/errors.js';

/** Expõe o Prisma (ou null) e o helper `app.db()` que valida a disponibilidade. */
export default fp(
  async (app) => {
    app.decorate('prisma', prisma);
    app.decorate('db', () => {
      if (!app.prisma) throw Errors.dbUnavailable();
      return app.prisma;
    });

    if (prisma) {
      const client = prisma;
      try {
        await client.$connect();
        app.log.info('🗄️  Prisma conectado ao PostgreSQL');
      } catch (err) {
        app.log.error({ err }, 'Falha ao conectar no PostgreSQL — API em modo degradado');
      }
      app.addHook('onClose', async () => {
        await client.$disconnect();
      });
    } else {
      app.log.warn('⚠️  DATABASE_URL vazio — rotas de domínio responderão 503');
    }
  },
  { name: 'prisma' },
);
