import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { env } from '../config/env.js';
import { Errors } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { getUserAuth } from '../lib/user-auth-cache.js';

/**
 * Registra @fastify/jwt e adiciona os preHandlers:
 *  - app.authenticate  -> exige access token válido; popula request.userId / userRole
 *  - app.requireAdmin   -> authenticate + role ADMIN
 *
 * O access token carrega `role`; ainda assim revalidamos no banco que o usuário
 * existe e está ACTIVE (barra usuários suspensos sem esperar o token expirar).
 */
export default fp(
  async (app) => {
    await app.register(jwt, {
      secret: env.JWT_ACCESS_SECRET,
      sign: { expiresIn: env.JWT_ACCESS_TTL },
    });

    app.decorate('authenticate', async (request: any) => {
      let payload: { sub: string; type: string; role?: 'ADMIN' | 'USER' };
      try {
        payload = await request.jwtVerify();
      } catch {
        throw Errors.unauthorized();
      }
      if (payload.type !== 'access') throw Errors.unauthorized();

      // revalida status/role — servido de um cache curto (ver user-auth-cache.ts)
      // para não custar 1 SELECT em cada requisição.
      if (prisma) {
        const user = await getUserAuth(prisma, payload.sub);
        if (!user) throw Errors.unauthorized();
        if (user.status === 'SUSPENDED') throw Errors.forbidden('Conta suspensa');
        if (user.status === 'PENDING') throw Errors.forbidden('Conta aguardando aprovação');
        request.userRole = user.role;
      } else {
        request.userRole = payload.role ?? 'USER';
      }
      request.userId = payload.sub;
    });

    app.decorate('requireAdmin', async (request: any, reply: any) => {
      await app.authenticate(request, reply);
      if (request.userRole !== 'ADMIN') throw Errors.forbidden('Requer permissão de administrador');
    });
  },
  { name: 'auth' },
);
