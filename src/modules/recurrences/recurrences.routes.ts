import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { recurrenceSchema, updateRecurrenceBodySchema } from '@nodepay/shared';
import { RecurrencesService } from './recurrences.service.js';
import { ownerFilter } from '../../lib/scope.js';

/** Rotas de **recorrências** (séries): listar, pausar/retomar, encerrar, excluir. */
export async function recurrenceRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.authenticate);
  const svc = () => new RecurrencesService(app.db());

  app.get(
    '/',
    {
      schema: {
        tags: ['recurrences'],
        querystring: z.object({ userId: z.string().optional() }),
        response: { 200: z.array(recurrenceSchema) },
      },
    },
    (req) => svc().list(ownerFilter(req, req.query.userId)),
  );

  app.get(
    '/:id',
    { schema: { tags: ['recurrences'], params: z.object({ id: z.string() }), response: { 200: recurrenceSchema } } },
    (req) => svc().get(ownerFilter(req), req.params.id),
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['recurrences'],
        params: z.object({ id: z.string() }),
        body: updateRecurrenceBodySchema,
        response: { 200: recurrenceSchema },
      },
    },
    (req) => svc().update(ownerFilter(req), req.params.id, req.body),
  );

  app.delete(
    '/:id',
    { schema: { tags: ['recurrences'], params: z.object({ id: z.string() }) } },
    (req) => svc().remove(ownerFilter(req), req.params.id),
  );
}
