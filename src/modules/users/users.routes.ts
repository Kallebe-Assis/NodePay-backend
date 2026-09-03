import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  adminCreateUserBodySchema,
  adminUpdateUserBodySchema,
  listUsersQuerySchema,
  userSchema,
} from '@nodepay/shared';
import { UsersService } from './users.service.js';

/** Rotas de **usuários** (só admin): CRUD + aprovar / suspender / reativar. */
export async function userRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.requireAdmin);
  const svc = () => new UsersService(app.db());

  app.get(
    '/',
    {
      schema: {
        tags: ['users'],
        querystring: listUsersQuerySchema,
        response: {
          200: z.object({
            data: z.array(userSchema),
            page: z.number().int(),
            pageSize: z.number().int(),
            total: z.number().int(),
          }),
        },
      },
    },
    (req) => svc().list(req.query),
  );

  app.get(
    '/:id',
    { schema: { tags: ['users'], params: z.object({ id: z.string() }), response: { 200: userSchema } } },
    (req) => svc().get(req.params.id),
  );

  app.post(
    '/',
    { schema: { tags: ['users'], body: adminCreateUserBodySchema, response: { 201: userSchema } } },
    async (req, reply) => reply.code(201).send(await svc().create(req.body)),
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['users'],
        params: z.object({ id: z.string() }),
        body: adminUpdateUserBodySchema,
        response: { 200: userSchema },
      },
    },
    (req) => svc().update(req.params.id, req.body, req.userId),
  );

  app.post(
    '/:id/approve',
    { schema: { tags: ['users'], params: z.object({ id: z.string() }), response: { 200: userSchema } } },
    (req) => svc().approve(req.params.id, req.userId),
  );

  app.post(
    '/:id/suspend',
    { schema: { tags: ['users'], params: z.object({ id: z.string() }), response: { 200: userSchema } } },
    (req) => svc().suspend(req.params.id, req.userId),
  );

  app.delete(
    '/:id',
    { schema: { tags: ['users'], params: z.object({ id: z.string() }) } },
    (req) => svc().remove(req.params.id, req.userId),
  );
}
