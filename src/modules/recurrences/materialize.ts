import type { PrismaClient } from '@prisma/client';
import { addDays, addMonths, type IsoDate, todaySP } from '@nodepay/shared';
import { dbDateToIso, isoToDbDate } from '../../lib/date.js';

/** Mantemos as recorrências FIXAS materializadas ~12 meses à frente de hoje. */
const FIXED_HORIZON_MONTHS = 12;
/** Trava de segurança contra loop infinito por recorrência. */
const MAX_STEPS_PER_RECURRENCE = 480;

/**
 * Estende os lançamentos das recorrências FIXAS (sem data-fim definida ou com
 * fim ainda distante) até o horizonte. Idempotente: antes de criar cada
 * lançamento confere se já existe um da mesma recorrência naquela competência.
 *
 * Rodado pelo job diário `recurrences:materialize` e pela rota de cron.
 */
export async function materializeFixedRecurrences(
  db: PrismaClient,
): Promise<{ recurrences: number; created: number }> {
  const today = todaySP();
  const horizon = addMonths(today, FIXED_HORIZON_MONTHS);

  const recs = await db.recurrence.findMany({
    where: { mode: 'FIXED', active: true },
    select: {
      id: true,
      userId: true,
      frequency: true,
      interval: true,
      startDate: true,
      endDate: true,
      materializedUntil: true,
      type: true,
      amount: true,
      description: true,
      accountId: true,
      categoryId: true,
    },
  });

  let created = 0;
  let touched = 0;

  for (const rec of recs) {
    const interval = Math.max(rec.interval || 1, 1);
    const step = (d: IsoDate): IsoDate =>
      rec.frequency === 'WEEKLY'
        ? addDays(d, 7 * interval)
        : rec.frequency === 'YEARLY'
          ? addMonths(d, 12 * interval)
          : addMonths(d, interval);

    const start: IsoDate = rec.materializedUntil
      ? dbDateToIso(rec.materializedUntil)
      : dbDateToIso(rec.startDate);
    const end: IsoDate | null = rec.endDate ? dbDateToIso(rec.endDate) : null;

    let cursor = step(start);
    let last: IsoDate = start;
    let madeSome = false;

    for (let i = 0; i < MAX_STEPS_PER_RECURRENCE && cursor <= horizon; i++) {
      if (end && cursor > end) break;

      const existing = await db.transaction.findFirst({
        where: { recurrenceId: rec.id, competenceDate: isoToDbDate(cursor) },
        select: { id: true },
      });
      if (!existing) {
        await db.transaction.create({
          data: {
            userId: rec.userId,
            type: rec.type,
            amount: rec.amount,
            description: rec.description,
            competenceDate: isoToDbDate(cursor),
            dueDate: isoToDbDate(cursor),
            paidDate: null,
            status: cursor > today ? 'SCHEDULED' : 'PENDING',
            accountId: rec.accountId,
            categoryId: rec.categoryId,
            recurrenceId: rec.id,
          },
        });
        created++;
        madeSome = true;
      }
      last = cursor;
      cursor = step(cursor);
    }

    if (madeSome || last !== start) {
      await db.recurrence.update({
        where: { id: rec.id },
        data: { materializedUntil: isoToDbDate(last) },
      });
      touched++;
    }
  }

  return { recurrences: touched, created };
}
