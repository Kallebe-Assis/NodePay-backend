import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { addDays, formatBRL, formatShortDate, todaySP } from '@nodepay/shared';
import { dbDateToIso, isoToDbDate } from '../../lib/date.js';
import { nb } from '../../lib/money.js';
import { runBackup } from '../backup/backup.service.js';
import { recordGoalOutcomes } from '../goals/outcomes.js';
import { sendMessage } from '../telegram/telegram.service.js';
import { materializeFixedRecurrences } from '../recurrences/materialize.js';
import { closeDueInvoices } from '../invoices/close.js';

/**
 * Implementação única de cada tarefa agendada. Consumida por:
 *  - `handlers.ts`  (workers do pg-boss, quando JOBS_ENABLED=true)
 *  - `cron.routes.ts` (POST /api/v1/internal/cron/:task, p/ scheduler externo)
 *
 * Cada função é idempotente e devolve um resumo numérico para log.
 */
export type TaskName =
  | 'recurrences-materialize'
  | 'invoices-close'
  | 'reminders-send'
  | 'goals-check'
  | 'backup-run'
  | 'telegram-digest';

export const TASK_NAMES: TaskName[] = [
  'recurrences-materialize',
  'invoices-close',
  'reminders-send',
  'goals-check',
  'backup-run',
  'telegram-digest',
];

type TaskFn = (db: PrismaClient, log: FastifyBaseLogger) => Promise<Record<string, number>>;

const tasks: Record<TaskName, TaskFn> = {
  'recurrences-materialize': (db) => materializeFixedRecurrences(db),

  'invoices-close': (db) => closeDueInvoices(db),

  'backup-run': async (db, log) => {
    const targets = await db.userSettings.findMany({
      where: { backupEnabled: true },
      select: { userId: true, backupFrequency: true },
    });
    const weekday = new Date().getUTCDay();
    let ran = 0;
    for (const t of targets) {
      if (t.backupFrequency === 'WEEKLY' && weekday !== 1) continue;
      try {
        await runBackup(db, t.userId);
        ran++;
      } catch (err) {
        log.error({ err, userId: t.userId }, 'backup automático falhou');
      }
    }
    return { candidates: targets.length, ran };
  },

  'goals-check': async (db, log) => {
    const userIds = [
      ...new Set(
        (await db.goal.findMany({ where: { active: true }, select: { userId: true } })).map(
          (g) => g.userId,
        ),
      ),
    ];
    let notified = 0;
    for (const userId of userIds) {
      const outcomes = await recordGoalOutcomes(db, userId).catch(() => []);
      for (const o of outcomes) {
        if (!o.firstObservation || !o.notifyTelegram) continue;
        const line = o.achieved
          ? `🎯 <b>Objetivo conquistado</b>\n${o.title}\n${o.period} — ${formatBRL(o.progress.current)}`
          : `⚠️ <b>Objetivo não atingido</b>\n${o.title}\n${o.period} — ${formatBRL(o.progress.current)} de ${formatBRL(o.progress.target)}`;
        await sendMessage(db, userId, line).catch((err) =>
          log.warn({ err, goalId: o.goalId }, 'falha ao notificar objetivo no Telegram'),
        );
        await db.goal.update({ where: { id: o.goalId }, data: { lastNotifiedPeriod: o.period } });
        notified++;
      }
    }
    return { users: userIds.length, notified };
  },

  'reminders-send': async (db, log) => {
    const today = todaySP();
    const candidates = await db.transaction.findMany({
      where: {
        remindTelegram: true,
        reminderSentAt: null,
        status: { in: ['PENDING', 'SCHEDULED'] },
        dueDate: { lte: isoToDbDate(addDays(today, 30)) },
      },
      select: {
        id: true,
        userId: true,
        description: true,
        amount: true,
        dueDate: true,
        type: true,
        remindDaysBefore: true,
      },
    });

    let sent = 0;
    for (const t of candidates) {
      const fireOn = addDays(dbDateToIso(t.dueDate), -t.remindDaysBefore);
      if (today < fireOn) continue;
      const isIncome = t.type === 'INCOME' || t.type === 'LOAN_DISBURSEMENT';
      const verb = isIncome ? 'a receber' : 'a pagar';
      await sendMessage(
        db,
        t.userId,
        `⏰ <b>Lembrete</b>\n${t.description}\n${verb} ${formatBRL(nb(t.amount))} · vence ${formatShortDate(dbDateToIso(t.dueDate))}`,
      ).catch((err) => log.warn({ err, txId: t.id }, 'falha ao enviar lembrete no Telegram'));
      await db.transaction.update({ where: { id: t.id }, data: { reminderSentAt: new Date() } });
      sent++;
    }
    return { candidates: candidates.length, sent };
  },

  'telegram-digest': async (_db, log) => {
    // Resumo diário consolidado ainda não implementado; lembretes e objetivos
    // já cobrem as notificações no Telegram.
    log.debug('telegram-digest — noop');
    return { skipped: 1 };
  },
};

export function isTaskName(v: string): v is TaskName {
  return (TASK_NAMES as string[]).includes(v);
}

export async function runTask(
  name: TaskName,
  db: PrismaClient,
  log: FastifyBaseLogger,
): Promise<Record<string, number>> {
  const started = Date.now();
  const result = await tasks[name](db, log);
  log.info({ task: name, ms: Date.now() - started, ...result }, 'tarefa agendada concluída');
  return result;
}
