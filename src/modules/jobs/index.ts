import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';

/**
 * Agendador em background com pg-boss (usa o próprio Postgres, sem Redis).
 * Fica DESLIGADO por padrão (JOBS_ENABLED=false). Quando ligado, agenda:
 *   - recurrences:materialize  (diário)  -> estende lançamentos fixos no horizonte
 *   - invoices:close           (diário)  -> fecha faturas na data de fechamento
 *   - backup:run               (conforme UserSettings.backupFrequency)
 *   - telegram:digest          (de hora em hora, dispara o resumo semanal no dia/hora configurado)
 *   - notifications:push       (diário, contas a vencer/fatura fechando/saldo baixo por Telegram)
 *
 * As funções de cada job vivem em ./handlers.ts (a implementar na fase 2/7).
 */
let boss: import('pg-boss') | null = null;

export async function startJobs(app: FastifyInstance): Promise<void> {
  if (!env.JOBS_ENABLED) {
    app.log.info('Jobs desativados (JOBS_ENABLED=false)');
    return;
  }
  if (!env.DATABASE_URL) {
    app.log.warn('Jobs habilitados mas DATABASE_URL vazio — pulando');
    return;
  }

  const PgBoss = (await import('pg-boss')).default;
  boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: env.PGBOSS_SCHEMA });
  boss.on('error', (err) => app.log.error({ err }, 'pg-boss error'));
  await boss.start();

  const QUEUES = [
    'recurrences:materialize',
    'invoices:close',
    'backup:run',
    'telegram:digest',
    'goals:check',
    'reminders:send',
    'notifications:push',
  ] as const;
  // pg-boss v10 exige a fila criada antes de agendar / consumir
  for (const name of QUEUES) await boss.createQueue(name);

  const { registerHandlers } = await import('./handlers.js');
  await registerHandlers(boss, app);

  await boss.schedule('recurrences:materialize', '0 3 * * *');
  await boss.schedule('invoices:close', '5 0 * * *');
  await boss.schedule('backup:run', '30 2 * * *');
  await boss.schedule('telegram:digest', '0 * * * *');
  await boss.schedule('goals:check', '15 6 * * *');
  await boss.schedule('reminders:send', '0 8 * * *');
  await boss.schedule('notifications:push', '0 8 * * *');

  app.log.info('⏰ Jobs agendados (pg-boss)');
}

export async function stopJobs(): Promise<void> {
  await boss?.stop({ graceful: true });
  boss = null;
}
