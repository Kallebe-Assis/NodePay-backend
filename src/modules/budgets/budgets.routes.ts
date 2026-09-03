import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  budgetBulkInputSchema,
  budgetInputSchema,
  budgetListResponseSchema,
} from '@nodepay/shared';
import { BudgetsService } from './budgets.service.js';
import { ownerFilter, targetOwnerId } from '../../lib/scope.js';

/** Rotas de **orçamento** mensal por categoria (envelope). */
export async function budgetRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.authenticate);
  const svc = () => new BudgetsService(app.db());

  const listQuery = z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    userId: z.string().optional(),
  });

  app.get(
    '/',
    { schema: { tags: ['budgets'], querystring: listQuery, response: { 200: budgetListResponseSchema } } },
    (req) => svc().list(ownerFilter(req, req.query.userId), req.query.month),
  );

  app.put(
    '/',
    {
      schema: {
        tags: ['budgets'],
        querystring: z.object({ userId: z.string().optional() }),
        body: budgetInputSchema,
        response: { 200: budgetListResponseSchema },
      },
    },
    (req) => svc().upsert(targetOwnerId(req, req.query.userId), req.body),
  );

  app.put(
    '/bulk',
    {
      schema: {
        tags: ['budgets'],
        querystring: z.object({ userId: z.string().optional() }),
        body: budgetBulkInputSchema,
        response: { 200: budgetListResponseSchema },
      },
    },
    (req) => svc().bulk(targetOwnerId(req, req.query.userId), req.body),
  );

  app.delete(
    '/:id',
    { schema: { tags: ['budgets'], params: z.object({ id: z.string() }) } },
    (req) => svc().remove(ownerFilter(req), req.params.id),
  );
}
