import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  authResponseSchema,
  authUserSchema,
  changePasswordBodySchema,
  loginBodySchema,
  refreshBodySchema,
  registerBodySchema,
  registrationPendingSchema,
  updateProfileBodySchema,
} from '@nodepay/shared';
import { z } from 'zod';
import { AuthService } from './auth.service.js';

/** Rotas de **autenticação**: registro (com aprovação), login, refresh, logout e perfil. */
export async function authRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const meta = (req: any) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });
  const svc = () => new AuthService(app, app.db());

  app.post(
    '/register',
    {
      schema: {
        tags: ['auth'],
        body: registerBodySchema,
        response: { 201: authResponseSchema, 202: registrationPendingSchema },
      },
    },
    async (req, reply) => {
      const out = await svc().register(req.body, meta(req));
      return reply.code(out.pending ? 202 : 201).send(out.result);
    },
  );

  app.post(
    '/login',
    { schema: { tags: ['auth'], body: loginBodySchema, response: { 200: authResponseSchema } } },
    async (req) => svc().login(req.body, meta(req)),
  );

  app.post(
    '/refresh',
    { schema: { tags: ['auth'], body: refreshBodySchema, response: { 200: authResponseSchema } } },
    async (req) => svc().refresh(req.body.refreshToken, meta(req)),
  );

  app.post(
    '/logout',
    { schema: { tags: ['auth'], body: refreshBodySchema } },
    async (req, reply) => {
      await svc().logout(req.body.refreshToken);
      return reply.code(204).send();
    },
  );

  app.get(
    '/me',
    { preHandler: app.authenticate, schema: { tags: ['auth'], response: { 200: authUserSchema } } },
    async (req) => svc().me(req.userId),
  );

  app.patch(
    '/me',
    {
      preHandler: app.authenticate,
      schema: { tags: ['auth'], body: updateProfileBodySchema, response: { 200: authUserSchema } },
    },
    async (req) => svc().updateProfile(req.userId, req.body.name),
  );

  app.post(
    '/change-password',
    {
      preHandler: app.authenticate,
      schema: { tags: ['auth'], body: changePasswordBodySchema },
    },
    async (req, reply) => {
      await svc().changePassword(req.userId, req.body.currentPassword, req.body.newPassword);
      return reply.code(204).send();
    },
  );

  app.get(
    '/sessions',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['auth'],
        response: {
          200: z.array(
            z.object({
              id: z.string(),
              userAgent: z.string().nullable(),
              ip: z.string().nullable(),
              createdAt: z.string(),
              expiresAt: z.string(),
            }),
          ),
        },
      },
    },
    async (req) => svc().listSessions(req.userId),
  );
}
