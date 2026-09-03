import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { categorySchema, createCategoryBodySchema, updateCategoryBodySchema } from '@nodepay/shared';
import { CategoriesService } from './categories.service.js';
import { ownerFilter, targetOwnerId } from '../../lib/scope.js';

/** Rotas de **categorias** (e subcategorias via `parentId`): CRUD. */
export async function categoryRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.authenticate);
  const svc = () => new CategoriesService(app.db());

  app.get(
    '/',
    {
      schema: {
        tags: ['categories'],
        querystring: z.object({
          kind: z.enum(['INCOME', 'EXPENSE']).optional(),
          parentId: z.string().optional(),
          userId: z.string().optional(),
        }),
        response: { 200: z.array(categorySchema) },
      },
    },
    (req) =>
      svc().list(ownerFilter(req, req.query.userId), {
        kind: req.query.kind,
        parentId: req.query.parentId,
      }),
  );

  app.get(
    '/:id',
    { schema: { tags: ['categories'], params: z.object({ id: z.string() }), response: { 200: categorySchema } } },
    (req) => svc().get(ownerFilter(req), req.params.id),
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['categories'],
        querystring: z.object({ userId: z.string().optional() }),
        body: createCategoryBodySchema,
        response: { 201: categorySchema },
      },
    },
    async (req, reply) =>
      reply.code(201).send(await svc().create(targetOwnerId(req, req.query.userId), req.body)),
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['categories'],
        params: z.object({ id: z.string() }),
        body: updateCategoryBodySchema,
        response: { 200: categorySchema },
      },
    },
    (req) => svc().update(ownerFilter(req), req.params.id, req.body),
  );

  app.delete(
    '/:id',
    { schema: { tags: ['categories'], params: z.object({ id: z.string() }) } },
    (req) => svc().remove(ownerFilter(req), req.params.id),
  );
}
