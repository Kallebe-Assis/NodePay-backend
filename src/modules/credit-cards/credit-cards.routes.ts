import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  booleanish,
  createCreditCardBodySchema,
  creditCardSchema,
  updateCreditCardBodySchema,
} from '@nodepay/shared';
import { CreditCardsService } from './credit-cards.service.js';
import { ownerFilter, targetOwnerId } from '../../lib/scope.js';

/** Rotas de **cartões de crédito**: CRUD (limite, dias de fechamento/vencimento, banco). */
export async function creditCardRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.authenticate);
  const svc = () => new CreditCardsService(app.db());

  app.get(
    '/',
    {
      schema: {
        tags: ['credit-cards'],
        querystring: z.object({
          includeArchived: booleanish(false),
          userId: z.string().optional(),
        }),
        response: { 200: z.array(creditCardSchema) },
      },
    },
    (req) => svc().list(ownerFilter(req, req.query.userId), req.query.includeArchived),
  );

  app.get(
    '/:id',
    { schema: { tags: ['credit-cards'], params: z.object({ id: z.string() }), response: { 200: creditCardSchema } } },
    (req) => svc().get(ownerFilter(req), req.params.id),
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['credit-cards'],
        querystring: z.object({ userId: z.string().optional() }),
        body: createCreditCardBodySchema,
        response: { 201: creditCardSchema },
      },
    },
    async (req, reply) =>
      reply.code(201).send(await svc().create(targetOwnerId(req, req.query.userId), req.body)),
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['credit-cards'],
        params: z.object({ id: z.string() }),
        body: updateCreditCardBodySchema,
        response: { 200: creditCardSchema },
      },
    },
    (req) => svc().update(ownerFilter(req), req.params.id, req.body),
  );

  app.delete(
    '/:id',
    { schema: { tags: ['credit-cards'], params: z.object({ id: z.string() }) } },
    (req) => svc().remove(ownerFilter(req), req.params.id),
  );
}
