import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { notificationsResponseSchema } from '@nodepay/shared';
import { NotificationsService } from './notifications.service.js';

/** Rota de **notificações**: feed calculado na hora (sem tabela). */
export async function notificationRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/',
    { schema: { tags: ['notifications'], response: { 200: notificationsResponseSchema } } },
    (req) =>
      new NotificationsService(app.db()).list(req.userId, req.userRole === 'ADMIN'),
  );
}
