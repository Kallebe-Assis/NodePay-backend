import type { Prisma, PrismaClient } from '@prisma/client';
import { buildPlacement, type CreditCardCycle, type IsoDate, toDateTime } from '@nodepay/shared';
import { isoToDbDate } from '../../lib/date.js';
import { nb, numToBig } from '../../lib/money.js';

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

/**
 * Confere o total MATERIALIZADO de cada fatura (`Invoice.total`) contra a
 * soma real dos lançamentos vinculados a ela; corrige no banco quem estiver
 * diferente e devolve o total CERTO de cada uma (id → centavos).
 *
 * Todo caminho de escrita já chama `recalcInvoiceTotal` na hora certa — isso
 * aqui é a rede de segurança da LEITURA (`GET /invoices`, `GET /credit-cards`):
 * mesmo que algum caminho futuro esqueça de recalcular, quem lê nunca vê um
 * valor desatualizado.
 */
export async function verifiedInvoiceTotals(
  db: Db,
  invoiceIds: string[],
): Promise<Map<string, number>> {
  const real = new Map<string, number>(invoiceIds.map((id) => [id, 0]));
  if (invoiceIds.length === 0) return real;

  const [sums, current] = await Promise.all([
    db.transaction.groupBy({
      by: ['invoiceId'],
      where: { invoiceId: { in: invoiceIds }, status: { not: 'CANCELED' } },
      _sum: { amount: true },
    }),
    db.invoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, total: true } }),
  ]);
  for (const s of sums) if (s.invoiceId) real.set(s.invoiceId, nb(s._sum.amount));

  const stale = current.filter((r) => nb(r.total) !== (real.get(r.id) ?? 0));
  if (stale.length > 0) {
    await Promise.all(
      stale.map((r) =>
        db.invoice.update({ where: { id: r.id }, data: { total: numToBig(real.get(r.id) ?? 0) } }),
      ),
    );
  }
  return real;
}
