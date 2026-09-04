import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import {
  addDays,
  formatBRL,
  formatShortDate,
  nowSP,
  OUTFLOW_TYPES,
  todaySP,
} from '@nodepay/shared';
import { dbDateToIso, isoToDbDate } from '../../lib/date.js';
import { nb } from '../../lib/money.js';
import { runBackup } from '../backup/backup.service.js';
import { recordGoalOutcomes } from '../goals/outcomes.js';
import { sendMessage } from '../telegram/telegram.service.js';
import { materializeFixedRecurrences } from '../recurrences/materialize.js';
import { closeDueInvoices } from '../invoices/close.js';
import { computeBalances } from '../accounts/balance.js';
import { computeWeeklySummary } from '../notifications/weekly-summary.js';

const isTelegramChannel = (ch: string | null | undefined) => ch === 'telegram' || ch === 'both';

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
  | 'telegram-digest'
  | 'notifications-push';

export const TASK_NAMES: TaskName[] = [
  'recurrences-materialize',
  'invoices-close',
  'reminders-send',
  'goals-check',
  'backup-run',
  'telegram-digest',
  'notifications-push',
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

  // Resumo SEMANAL por Telegram: roda de hora em hora, só age quando o
  // dia-da-semana + hora configurados pelo usuário batem com agora (SP).
  'telegram-digest': async (db, log) => {
    const now = nowSP();
    const weekday = now.weekday % 7; // Luxon: 1=seg…7=dom -> 0=dom…6=sáb
    const isoWeek = `${now.weekYear}-W${String(now.weekNumber).padStart(2, '0')}`;

    const candidates = await db.userSettings.findMany({
      where: {
        telegramEnabled: true,
        notifyWeeklySummaryChannel: { in: ['telegram', 'both'] },
        weeklySummaryDay: weekday,
        weeklySummaryHour: now.hour,
        OR: [{ weeklySummaryLastSentWeek: null }, { weeklySummaryLastSentWeek: { not: isoWeek } }],
      },
      select: { userId: true },
    });

    let sent = 0;
    for (const s of candidates) {
      const w = await computeWeeklySummary(db, s.userId);
      const line =
        `📊 <b>Resumo da semana</b>\n${formatShortDate(w.from)} a ${formatShortDate(w.to)}\n` +
        `Receitas: ${formatBRL(w.income)}\nDespesas: ${formatBRL(w.expense)}\nResultado: ${formatBRL(w.net)}` +
        (w.topCategory ? `\nMaior gasto: ${w.topCategory.name} (${formatBRL(w.topCategory.total)})` : '');
      await sendMessage(db, s.userId, line).catch((err) =>
        log.warn({ err, userId: s.userId }, 'falha ao enviar resumo semanal no Telegram'),
      );
      await db.userSettings.update({
        where: { userId: s.userId },
        data: { weeklySummaryLastSentWeek: isoWeek },
      });
      sent++;
    }
    return { candidates: candidates.length, sent };
  },

  // Push diário consolidado (contas a vencer / fatura fechando / saldo baixo)
  // para quem escolheu canal telegram/both nessas preferências. 1x por dia.
  'notifications-push': async (db, log) => {
    const today = todaySP();
    const candidates = await db.userSettings.findMany({
      where: {
        telegramEnabled: true,
        OR: [
          { notifyBillsDueChannel: { in: ['telegram', 'both'] } },
          { notifyInvoiceClosingChannel: { in: ['telegram', 'both'] } },
          { notifyLowBalanceChannel: { in: ['telegram', 'both'] } },
        ],
        AND: [
          { OR: [{ notifyTelegramLastSentDate: null }, { notifyTelegramLastSentDate: { not: today } }] },
        ],
      },
      select: {
        userId: true,
        notifyBillsDueChannel: true,
        notifyInvoiceClosingChannel: true,
        notifyLowBalanceChannel: true,
        lowBalanceThreshold: true,
      },
    });

    let sent = 0;
    for (const s of candidates) {
      const lines: string[] = [];

      if (isTelegramChannel(s.notifyBillsDueChannel)) {
        const bills = await db.transaction.count({
          where: {
            userId: s.userId,
            type: { in: OUTFLOW_TYPES },
            status: { in: ['PENDING', 'SCHEDULED'] },
            dueDate: { lte: isoToDbDate(addDays(today, 7)) },
          },
        });
        if (bills > 0) lines.push(`📅 <b>${bills} conta(s) a vencer</b> nos próximos 7 dias`);
      }

      if (isTelegramChannel(s.notifyInvoiceClosingChannel)) {
        const invoices = await db.invoice.count({
          where: { userId: s.userId, status: 'OPEN', closingDate: { lte: isoToDbDate(addDays(today, 3)) } },
        });
        if (invoices > 0) lines.push(`💳 <b>${invoices} fatura(s)</b> fechando nos próximos 3 dias`);
      }

      const threshold = nb(s.lowBalanceThreshold);
      if (isTelegramChannel(s.notifyLowBalanceChannel) && threshold > 0) {
        const balances = await computeBalances(db, { userId: s.userId });
        const total = [...balances.values()].reduce((sum, b) => sum + b.projectedBalance, 0);
        if (total < threshold) lines.push(`⚠️ <b>Saldo projetado baixo</b>: ${formatBRL(total)}`);
      }

      if (lines.length > 0) {
        await sendMessage(db, s.userId, lines.join('\n')).catch((err) =>
          log.warn({ err, userId: s.userId }, 'falha ao enviar push de notificações no Telegram'),
        );
        sent++;
      }
      await db.userSettings.update({
        where: { userId: s.userId },
        data: { notifyTelegramLastSentDate: today },
      });
    }
    return { candidates: candidates.length, sent };
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
