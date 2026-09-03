import type { PrismaClient } from '@prisma/client';
import type { PayInvoiceBody } from '@nodepay/shared';
import { Errors } from '../../lib/errors.js';
import { nb, numToBig } from '../../lib/money.js';
import { dbDateToIso, isoToDbDate } from '../../lib/date.js';
import { recalcInvoiceTotal } from './invoice.helpers.js';

export class InvoicesService {
  constructor(private readonly db: PrismaClient) {}

  async list(
    scope: { userId?: string },
    filter: { creditCardId?: string; status?: string },
  ) {
    const rows = await this.db.invoice.findMany({
      where: {
        ...(scope.userId ? { userId: scope.userId } : {}),
        ...(filter.creditCardId ? { creditCardId: filter.creditCardId } : {}),
        ...(filter.status ? { status: filter.status as any } : {}),
      },
      orderBy: [{ referenceMonth: 'desc' }],
    });
    return rows.map((r) => this.present(r));
  }

  async get(scope: { userId?: string }, id: string) {
    const inv = await this.db.invoice.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
      include: {
        items: { orderBy: [{ competenceDate: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    if (!inv) throw Errors.notFound('Fatura');
    return {
      ...this.present(inv),
      items: inv.items.map((t) => ({
        id: t.id,
        description: t.description,
        amount: nb(t.amount),
        competenceDate: dbDateToIso(t.competenceDate),
        categoryId: t.categoryId,
        installmentNumber: t.installmentNumber,
        installmentTotal: t.installmentTotal,
      })),
    };
  }

  /** Fecha a fatura (normalmente feito por job na data de fechamento). */
  async close(scope: { userId?: string }, id: string) {
    const inv = await this.db.invoice.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
    });
    if (!inv) throw Errors.notFound('Fatura');
    if (inv.status !== 'OPEN') throw Errors.badRequest('Fatura não está aberta');
    await recalcInvoiceTotal(this.db, id);
    const updated = await this.db.invoice.update({ where: { id }, data: { status: 'CLOSED' } });
    return this.present(updated);
  }

  /** Paga a fatura: gera um lançamento INVOICE_PAYMENT na conta escolhida. */
  async pay(scope: { userId?: string }, id: string, body: PayInvoiceBody) {
    return this.db.$transaction(async (tx) => {
      const inv = await tx.invoice.findFirst({
        where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
      });
      if (!inv) throw Errors.notFound('Fatura');
      if (inv.status === 'PAID') throw Errors.badRequest('Fatura já paga');
      const userId = inv.userId;

      const account = await tx.account.findFirst({
        where: { id: body.accountId, userId },
        select: { id: true },
      });
      if (!account) throw Errors.badRequest('Conta inválida');

      await recalcInvoiceTotal(tx, id);
      const fresh = await tx.invoice.findUniqueOrThrow({ where: { id } });
      const amount = body.amount ?? nb(fresh.total);
      if (amount <= 0) throw Errors.badRequest('Fatura sem valor a pagar');

      const payment = await tx.transaction.create({
        data: {
          userId,
          type: 'INVOICE_PAYMENT',
          amount: numToBig(amount),
          description: `Pagamento fatura`,
          competenceDate: fresh.closingDate,
          dueDate: fresh.dueDate,
          paidDate: isoToDbDate(body.paidDate),
          status: 'PAID',
          accountId: body.accountId,
          creditCardId: fresh.creditCardId,
        },
      });

      const updated = await tx.invoice.update({
        where: { id },
        data: { status: 'PAID', paidTransactionId: payment.id },
      });
      return this.present(updated);
    });
  }

  private present(i: any) {
    return {
      id: i.id,
      creditCardId: i.creditCardId,
      referenceMonth: dbDateToIso(i.referenceMonth),
      periodStart: dbDateToIso(i.periodStart),
      periodEnd: dbDateToIso(i.periodEnd),
      closingDate: dbDateToIso(i.closingDate),
      dueDate: dbDateToIso(i.dueDate),
      status: i.status,
      total: nb(i.total),
      paidTransactionId: i.paidTransactionId,
    };
  }
}
