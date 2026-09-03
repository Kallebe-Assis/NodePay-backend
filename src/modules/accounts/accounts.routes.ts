import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  accountSchema,
  booleanish,
  createAccountBodySchema,
  updateAccountBodySchema,
} from '@nodepay/shared';
import { AccountsService } from './accounts.service.js';
import { ownerFilter, targetOwnerId } from '../../lib/scope.js';

/** Rotas de **contas**: CRUD + saldos (atual/projetado) por conta. */
export async function accountRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.authenticate);
  const svc = () => new AccountsService(app.db());

  app.get(
    '/',
    {
      schema: {
        tags: ['accounts'],
        querystring: z.object({
          includeArchived: booleanish(false),
          userId: z.string().optional(),
        }),
        response: { 200: z.array(accountSchema) },
      },
    },
    (req) => svc().list(ownerFilter(req, req.query.userId), req.query.includeArchived),
  );

  app.get(
    '/:id',
    { schema: { tags: ['accounts'], params: z.object({ id: z.string() }), response: { 200: accountSchema } } },
    (req) => svc().get(ownerFilter(req), req.params.id),
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['accounts'],
        querystring: z.object({ userId: z.string().optional() }),
        body: createAccountBodySchema,
        response: { 201: accountSchema },
      },
    },
    async (req, reply) =>
      reply.code(201).send(await svc().create(targetOwnerId(req, req.query.userId), req.body)),
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['accounts'],
        params: z.object({ id: z.string() }),
        body: updateAccountBodySchema,
        response: { 200: accountSchema },
      },
    },
    (req) => svc().update(ownerFilter(req), req.params.id, req.body),
  );

  app.delete(
    '/:id',
    { schema: { tags: ['accounts'], params: z.object({ id: z.string() }) } },
    (req) => svc().remove(ownerFilter(req), req.params.id),
  );
}
