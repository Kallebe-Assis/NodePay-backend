import type PgBoss from 'pg-boss';
import type { FastifyInstance } from 'fastify';
import { getPrisma } from '../../lib/prisma.js';
import { runTask, type TaskName } from './tasks.js';

/**
 * Workers do pg-boss. Só rodam com JOBS_ENABLED=true. Cada fila apenas delega
 * para a implementação única em `tasks.ts` (a mesma usada pela rota de cron).
 */
const QUEUE_TO_TASK: Record<string, TaskName> = {
  'recurrences:materialize': 'recurrences-materialize',
  'invoices:close': 'invoices-close',
  'backup:run': 'backup-run',
  'telegram:digest': 'telegram-digest',
  'goals:check': 'goals-check',
  'reminders:send': 'reminders-send',
};

export async function registerHandlers(boss: PgBoss, app: FastifyInstance): Promise<void> {
  for (const [queue, task] of Object.entries(QUEUE_TO_TASK)) {
    await boss.work(queue, async () => {
      await runTask(task, getPrisma(), app.log);
    });
  }
}
