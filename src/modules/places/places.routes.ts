import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createPlaceBodySchema,
  listPlacesQuerySchema,
  placeSchema,
  updatePlaceBodySchema,
} from '@nodepay/shared';
import { PlacesService } from './places.service.js';
import { ownerFilter, targetOwnerId } from '../../lib/scope.js';

/** Rotas de **locais de compra**: CRUD + gasto do mês por local. */
export async function placeRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.authenticate);
  const svc = () => new PlacesService(app.db());

  app.get(
    '/',
    {
      schema: {
        tags: ['places'],
        querystring: listPlacesQuerySchema,
        response: { 200: z.array(placeSchema) },
      },
    },
    (req) => svc().list(ownerFilter(req, req.query.userId), req.query),
  );

  app.get(
    '/:id',
    { schema: { tags: ['places'], params: z.object({ id: z.string() }), response: { 200: placeSchema } } },
    (req) => svc().get(ownerFilter(req), req.params.id),
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['places'],
        querystring: z.object({ userId: z.string().optional() }),
        body: createPlaceBodySchema,
        response: { 201: placeSchema },
      },
    },
    async (req, reply) =>
      reply.code(201).send(await svc().create(targetOwnerId(req, req.query.userId), req.body)),
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['places'],
        params: z.object({ id: z.string() }),
        body: updatePlaceBodySchema,
        response: { 200: placeSchema },
      },
    },
    (req) => svc().update(ownerFilter(req), req.params.id, req.body),
  );

  app.delete(
    '/:id',
    { schema: { tags: ['places'], params: z.object({ id: z.string() }) } },
    (req) => svc().remove(ownerFilter(req), req.params.id),
  );
}
