import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { changelogResponseSchema } from '@nodepay/shared';
import { ChangelogService } from './changelog.service.js';

/** Rota do changelog: histórico de commits (backend + frontend) com versão incremental. */
export async function changelogRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.authenticate);
  const svc = new ChangelogService();

  app.get(
    '/',
    { schema: { tags: ['changelog'], response: { 200: changelogResponseSchema } } },
    () => svc.list(),
  );
}
