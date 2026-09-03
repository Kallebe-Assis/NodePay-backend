import type PgBoss from 'pg-boss';
import type { FastifyInstance } from 'fastify';
import { addDays, formatBRL, formatShortDate, todaySP } from '@nodepay/shared';
import { getPrisma } from '../../lib/prisma.js';
import { dbDateToIso, isoToDbDate } from '../../lib/date.js';
import { runBackup } from '../backup/backup.service.js';
import { recordGoalOutcomes } from '../goals/outcomes.js';
import { sendMessage } from '../telegram/telegram.service.js';

/**
 * Workers de cada fila em background (pg-boss). Só rodam com JOBS_ENABLED=true.
 * recurrences:materialize e invoices:close ainda são esqueleto (fases 2/3).
 */
export async function registerHandlers(boss: PgBoss, app: FastifyInstance): Promise<void> {
  await boss.work('recurrences:materialize', async () => {
    app.log.debug('job recurrences:materialize — noop (fase 2)');
  });

  await boss.work('invoices:close', async () => {
    app.log.debug('job invoices:close — noop (fase 3)');
  });

  await boss.work('backup:run', async () => {
    const db = getPrisma();
    const targets = await db.userSettings.findMany({
      where: { backupEnabled: true },
      select: { userId: true, backupFrequency: true },
    });
    const weekday = new Date().getUTCDay();
    for (const t of targets) {
      if (t.backupFrequency === 'WEEKLY' && weekday !== 1) continue;
      await runBackup(db, t.userId).catch((err) =>
        app.log.error({ err, userId: t.userId }, 'backup automático falhou'),
      );
    }
  });

  await boss.work('telegram:digest', async () => {
    app.log.debug('job telegram:digest — noop (fase 7)');
  });

  // Objetivos: confere o mês encerrado; envia Telegram uma vez por período.
  await boss.work('goals:check', async () => {
    const db = getPrisma();
    const userIds = (await db.goal.findMany({ where: { active: true }, select: { userId: true } }))
      .map((g) => g.userId)
      .filter((v, i, a) => a.indexOf(v) === i);

    for (const userId of userIds) {
      const outcomes = await recordGoalOutcomes(db, userId).catch(() => []);
      for (const o of outcomes) {
        if (!o.firstObservation || !o.notifyTelegram) continue;
        const line = o.achieved
          ? `🎯 <b>Objetivo conquistado</b>\n${o.title}\n${o.period} — ${formatBRL(o.progress.current)}`
          : `⚠️ <b>Objetivo não atingido</b>\n${o.title}\n${o.period} — ${formatBRL(o.progress.current)} de ${formatBRL(o.progress.target)}`;
        await sendMessage(db, userId, line).catch((err) =>
          app.log.warn({ err, goalId: o.goalId }, 'falha ao notificar objetivo no Telegram'),
        );
        await db.goal.update({
          where: { id: o.goalId },
          data: { lastNotifiedPeriod: o.period },
        });
      }
    }
  });

  // Lembretes de lançamento no Telegram: X dias antes do vencimento.
  await boss.work('reminders:send', async () => {
    const db = getPrisma();
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

    for (const t of candidates) {
      const fireOn = addDays(dbDateToIso(t.dueDate), -t.remindDaysBefore);
      if (today < fireOn) continue; // ainda não chegou a hora
      const isIncome = t.type === 'INCOME' || t.type === 'LOAN_DISBURSEMENT';
      const verb = isIncome ? 'a receber' : 'a pagar';
      await sendMessage(
        db,
        t.userId,
        `⏰ <b>Lembrete</b>\n${t.description}\n${verb} ${formatBRL(Number(t.amount))} · vence ${formatShortDate(dbDateToIso(t.dueDate))}`,
      ).catch((err) => app.log.warn({ err, txId: t.id }, 'falha ao enviar lembrete no Telegram'));
      await db.transaction.update({ where: { id: t.id }, data: { reminderSentAt: new Date() } });
    }
  });
}
