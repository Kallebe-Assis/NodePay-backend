import type { PrismaClient } from '@prisma/client';
import { addDays, addMonths, invoicesForInstallments, type IsoDate, todaySP } from '@nodepay/shared';
import { dbDateToIso, isoToDbDate } from '../../lib/date.js';
import { ensureInvoice, recalcInvoiceTotal } from '../invoices/invoice.helpers.js';

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
      creditCardId: true,
      categoryId: true,
    },
  });

  let created = 0;
  let touched = 0;
  const cardCache = new Map<string, { closingDay: number; dueDay: number } | null>();

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

    // Série de compra no cartão: cada ocorrência vai pra fatura do ciclo da data.
    let cardCycle: { closingDay: number; dueDay: number } | null = null;
    if (rec.creditCardId) {
      if (!cardCache.has(rec.creditCardId)) {
        const c = await db.creditCard.findUnique({
          where: { id: rec.creditCardId },
          select: { closingDay: true, dueDay: true },
        });
        cardCache.set(rec.creditCardId, c);
      }
      cardCycle = cardCache.get(rec.creditCardId) ?? null;
      if (!cardCycle) continue; // cartão apagado — nada a materializar
    }
    const touchedInvoices = new Set<string>();

    for (let i = 0; i < MAX_STEPS_PER_RECURRENCE && cursor <= horizon; i++) {
      if (end && cursor > end) break;

      const existing = await db.transaction.findFirst({
        where: { recurrenceId: rec.id, competenceDate: isoToDbDate(cursor) },
        select: { id: true },
      });
      if (!existing && cardCycle && rec.creditCardId) {
        const placement = invoicesForInstallments(cursor, 1, cardCycle)[0]!;
        const invoice = await ensureInvoice(db, {
          userId: rec.userId,
          creditCardId: rec.creditCardId,
          referenceMonth: placement.referenceMonth,
          cycle: cardCycle,
        });
        await db.transaction.create({
          data: {
            userId: rec.userId,
            type: 'CARD_EXPENSE',
            amount: rec.amount,
            description: rec.description,
            competenceDate: isoToDbDate(cursor),
            dueDate: invoice.dueDate,
            paidDate: null,
            status: 'PENDING',
            creditCardId: rec.creditCardId,
            invoiceId: invoice.id,
            categoryId: rec.categoryId,
            recurrenceId: rec.id,
          },
        });
        touchedInvoices.add(invoice.id);
        created++;
        madeSome = true;
      } else if (!existing) {
        await db.transaction.create({
          data: {
            userId: rec.userId,
            type: rec.type,
            amount: rec.amount,
            description: rec.description,
            competenceDate: isoToDbDate(cursor),
            dueDate: isoToDbDate(cursor),
            paidDate: null,
            // Recorrência FIXA nasce sempre PENDENTE — o usuário confirma cada
            // pagamento (data + valor total/parcial).
            status: 'PENDING',
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

    for (const invId of touchedInvoices) await recalcInvoiceTotal(db, invId);

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
