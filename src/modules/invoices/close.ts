import type { PrismaClient } from '@prisma/client';
import { todaySP } from '@nodepay/shared';
import { isoToDbDate } from '../../lib/date.js';
import { recalcInvoiceTotal } from './invoice.helpers.js';

/**
 * Fecha todas as faturas OPEN cuja data de fechamento já passou (recalcula o
 * total e move para CLOSED). Rodado pelo job diário `invoices:close` e pela
 * rota de cron. Idempotente — só toca faturas ainda abertas.
 */
export async function closeDueInvoices(db: PrismaClient): Promise<{ closed: number }> {
  const today = todaySP();
  const due = await db.invoice.findMany({
    where: { status: 'OPEN', closingDate: { lte: isoToDbDate(today) } },
    select: { id: true },
  });

  for (const inv of due) {
    await recalcInvoiceTotal(db, inv.id);
    await db.invoice.update({ where: { id: inv.id }, data: { status: 'CLOSED' } });
  }

  return { closed: due.length };
}
