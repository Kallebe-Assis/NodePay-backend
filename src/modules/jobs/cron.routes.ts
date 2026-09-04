import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { Errors } from '../../lib/errors.js';
import { isTaskName, runTask, TASK_NAMES, type TaskName } from './tasks.js';

/**
 * Rotas para acionar as tarefas agendadas a partir de um scheduler externo
 * (Render Cron Job, GitHub Actions, cron de VPS…), sem precisar do pg-boss
 * rodando dentro do processo web.
 *
 * Protegidas pelo header `x-cron-key` == `CRON_SECRET`. Se `CRON_SECRET` não
 * estiver definido, estas rotas nem são registradas (404).
 *
 *   curl -X POST -H "x-cron-key: $CRON_SECRET" \
 *     https://<api>/api/v1/internal/cron/invoices-close
 */
export async function cronRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  if (!env.CRON_SECRET) {
    app.log.warn('CRON_SECRET não definido — rotas /internal/cron desativadas');
    return;
  }
  const secret = env.CRON_SECRET;

  const assertKey = (req: { headers: Record<string, unknown> }) => {
    const key = req.headers['x-cron-key'];
    if (typeof key !== 'string' || key !== secret) throw Errors.unauthorized();
  };

  app.post(
    '/cron/:task',
    {
      schema: {
        tags: ['internal'],
        params: z.object({ task: z.string() }),
        response: { 200: z.object({ task: z.string(), result: z.record(z.number()) }) },
      },
    },
    async (req) => {
      assertKey(req);
      if (!isTaskName(req.params.task)) {
        throw Errors.badRequest(`Tarefa desconhecida. Use uma de: ${TASK_NAMES.join(', ')}`);
      }
      const result = await runTask(req.params.task, app.db(), app.log);
      return { task: req.params.task, result };
    },
  );

  // Atalho: roda o conjunto "diário" numa chamada só.
  app.post(
    '/cron',
    { schema: { tags: ['internal'], response: { 200: z.object({ ran: z.array(z.string()) }) } } },
    async (req) => {
      assertKey(req);
      const daily: TaskName[] = [
        'recurrences-materialize',
        'invoices-close',
        'reminders-send',
        'goals-check',
        'backup-run',
        'notifications-push',
      ];
      for (const t of daily) {
        await runTask(t, app.db(), app.log).catch((err) =>
          app.log.error({ err, task: t }, 'cron: tarefa falhou'),
        );
      }
      return { ran: daily };
    },
  );
}
