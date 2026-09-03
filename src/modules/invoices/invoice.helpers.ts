import type { Prisma, PrismaClient } from '@prisma/client';
import { buildPlacement, type CreditCardCycle, type IsoDate, toDateTime } from '@nodepay/shared';
import { isoToDbDate } from '../../lib/date.js';
import { nb } from '../../lib/money.js';

type Db = PrismaClient | Prisma.TransactionClient;

/** Garante que existe a fatura de um cartão para o mês de referência dado. */
export async function ensureInvoice(
  db: Db,
  params: { userId: string; creditCardId: string; referenceMonth: IsoDate; cycle: CreditCardCycle },
) {
  const ref = toDateTime(params.referenceMonth);
  const placement = buildPlacement(ref.year, ref.month, params.cycle);
  return db.invoice.upsert({
    where: {
      creditCardId_referenceMonth: {
        creditCardId: params.creditCardId,
        referenceMonth: isoToDbDate(placement.referenceMonth),
      },
    },
    create: {
      userId: params.userId,
      creditCardId: params.creditCardId,
      referenceMonth: isoToDbDate(placement.referenceMonth),
      periodStart: isoToDbDate(placement.periodStart),
      periodEnd: isoToDbDate(placement.periodEnd),
      closingDate: isoToDbDate(placement.closingDate),
      dueDate: isoToDbDate(placement.dueDate),
      status: 'OPEN',
    },
    update: {},
  });
}

/** Recalcula o total materializado de uma fatura a partir dos seus itens. */
export async function recalcInvoiceTotal(db: Db, invoiceId: string) {
  const agg = await db.transaction.aggregate({
    where: { invoiceId, status: { not: 'CANCELED' } },
    _sum: { amount: true },
  });
  await db.invoice.update({ where: { id: invoiceId }, data: { total: BigInt(nb(agg._sum.amount)) } });
}
