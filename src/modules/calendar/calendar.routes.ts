import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { calendarQuerySchema, calendarResponseSchema } from '@nodepay/shared';
import { CalendarService } from './calendar.service.js';
import { ownerFilter } from '../../lib/scope.js';

/** Rota de **calendário**: resumo diário de receitas/despesas de um mês. */
export async function calendarRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/',
    {
      schema: {
        tags: ['calendar'],
        querystring: calendarQuerySchema,
        response: { 200: calendarResponseSchema },
      },
    },
    (req) =>
      new CalendarService(app.db()).month(ownerFilter(req, req.query.userId), req.query.month),
  );
}
