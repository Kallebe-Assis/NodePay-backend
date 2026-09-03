import 'fastify';
import type { PrismaClient } from '@prisma/client';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient | null;
    /** lança 503 se o banco não estiver configurado, senão devolve o client */
    db: () => PrismaClient;
    /** preHandler: exige autenticação */
    authenticate: (request: any, reply: any) => Promise<void>;
    /** preHandler: exige autenticação + role ADMIN */
    requireAdmin: (request: any, reply: any) => Promise<void>;
  }

  interface FastifyRequest {
    /** preenchido pelo hook de autenticação nas rotas protegidas */
    userId: string;
    userRole: 'ADMIN' | 'USER';
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; type: 'access' | 'refresh'; role?: 'ADMIN' | 'USER' };
    user: { sub: string; type: 'access' | 'refresh'; role?: 'ADMIN' | 'USER' };
  }
}
