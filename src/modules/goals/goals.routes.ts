import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createGoalBodySchema, goalSchema, updateGoalBodySchema } from '@nodepay/shared';
import { GoalsService } from './goals.service.js';
import { ownerFilter, targetOwnerId } from '../../lib/scope.js';

/** Rotas de **objetivos** (metas): CRUD + progresso calculado do período. */
export async function goalRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.authenticate);
  const svc = () => new GoalsService(app.db());

  app.get(
    '/',
    {
      schema: {
        tags: ['goals'],
        querystring: z.object({ userId: z.string().optional() }),
        response: { 200: z.array(goalSchema) },
      },
    },
    (req) => svc().list(ownerFilter(req, req.query.userId)),
  );

  app.get(
    '/:id',
    { schema: { tags: ['goals'], params: z.object({ id: z.string() }), response: { 200: goalSchema } } },
    (req) => svc().get(ownerFilter(req), req.params.id),
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['goals'],
        querystring: z.object({ userId: z.string().optional() }),
        body: createGoalBodySchema,
        response: { 201: goalSchema },
      },
    },
    async (req, reply) =>
      reply.code(201).send(await svc().create(targetOwnerId(req, req.query.userId), req.body)),
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['goals'],
        params: z.object({ id: z.string() }),
        body: updateGoalBodySchema,
        response: { 200: goalSchema },
      },
    },
    (req) => svc().update(ownerFilter(req), req.params.id, req.body),
  );

  app.delete(
    '/:id',
    { schema: { tags: ['goals'], params: z.object({ id: z.string() }) } },
    (req) => svc().remove(ownerFilter(req), req.params.id),
  );
}
