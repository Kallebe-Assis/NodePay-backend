import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  categoryRuleInputSchema,
  categoryRuleMatchQuerySchema,
  categoryRuleMatchResponseSchema,
  categoryRuleSchema,
} from '@nodepay/shared';
import { CategoryRulesService } from './category-rules.service.js';
import { ownerFilter, targetOwnerId } from '../../lib/scope.js';

/** Rotas de **regras de auto-categorização**. */
export async function categoryRuleRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.authenticate);
  const svc = () => new CategoryRulesService(app.db());

  app.get(
    '/',
    {
      schema: {
        tags: ['category-rules'],
        querystring: z.object({ userId: z.string().optional() }),
        response: { 200: z.array(categoryRuleSchema) },
      },
    },
    (req) => svc().list(ownerFilter(req, req.query.userId)),
  );

  app.get(
    '/match',
    {
      schema: {
        tags: ['category-rules'],
        querystring: categoryRuleMatchQuerySchema.extend({ userId: z.string().optional() }),
        response: { 200: categoryRuleMatchResponseSchema },
      },
    },
    (req) => svc().match(ownerFilter(req, req.query.userId), req.query.description),
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['category-rules'],
        querystring: z.object({ userId: z.string().optional() }),
        body: categoryRuleInputSchema,
        response: { 201: z.array(categoryRuleSchema) },
      },
    },
    async (req, reply) =>
      reply.code(201).send(await svc().create(targetOwnerId(req, req.query.userId), req.body)),
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['category-rules'],
        params: z.object({ id: z.string() }),
        body: categoryRuleInputSchema.partial(),
        response: { 200: z.array(categoryRuleSchema) },
      },
    },
    (req) => svc().update(ownerFilter(req), req.params.id, req.body),
  );

  app.delete(
    '/:id',
    { schema: { tags: ['category-rules'], params: z.object({ id: z.string() }) } },
    (req) => svc().remove(ownerFilter(req), req.params.id),
  );
}
