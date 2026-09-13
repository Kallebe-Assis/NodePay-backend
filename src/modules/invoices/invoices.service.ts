import type { PrismaClient } from '@prisma/client';
import type { PayInvoiceBody } from '@nodepay/shared';
import { Errors } from '../../lib/errors.js';
import { nb, numToBig } from '../../lib/money.js';
import { dbDateToIso, isoToDbDate } from '../../lib/date.js';
import { recalcInvoiceTotal, verifiedInvoiceTotals } from './invoice.helpers.js';

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
    // Confere o total de cada uma contra a soma real dos lançamentos (e
    // corrige sozinho se algum ficou desatualizado) antes de responder.
    const real = await verifiedInvoiceTotals(this.db, rows.map((r) => r.id));
    return rows.map((r) => this.present(r, real.get(r.id)));
  }

  async get(scope: { userId?: string }, id: string) {
    const inv = await this.db.invoice.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
      include: {
        items: { orderBy: [{ competenceDate: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    if (!inv) throw Errors.notFound('Fatura');
    const real = await verifiedInvoiceTotals(this.db, [inv.id]);
    return {
      ...this.present(inv, real.get(inv.id)),
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

  /**
   * Reabre uma fatura FECHADA ou PAGA — volta para OPEN. Reabrir uma fatura
   * PAGA desfaz o pagamento (apaga o lançamento INVOICE_PAYMENT gerado); o
   * frontend confirma isso com o usuário antes de chamar esta rota.
   */
  async reopen(scope: { userId?: string }, id: string) {
    const inv = await this.db.invoice.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
    });
    if (!inv) throw Errors.notFound('Fatura');
    if (inv.status === 'OPEN') throw Errors.badRequest('Fatura já está aberta.');

    return this.db.$transaction(async (tx) => {
      if (inv.status === 'PAID' && inv.paidTransactionId) {
        await tx.transaction.delete({ where: { id: inv.paidTransactionId } }).catch(() => undefined);
        // Desfaz o pagamento: as compras dessa fatura que tinham virado PAID
        // (junto com a fatura) voltam a ficar pendentes.
        await tx.transaction.updateMany({
          where: { invoiceId: id, status: 'PAID' },
          data: { status: 'PENDING', paidDate: null, paidAmount: numToBig(0) },
        });
      }
      await tx.invoice.update({ where: { id }, data: { status: 'OPEN', paidTransactionId: null } });
      await recalcInvoiceTotal(tx, id);
      const fresh = await tx.invoice.findUniqueOrThrow({ where: { id } });
      return this.present(fresh);
    });
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
          includeInTotals: body.includeInTotals ?? true,
        },
      });

      const updated = await tx.invoice.update({
        where: { id },
        data: { status: 'PAID', paidTransactionId: payment.id },
      });

      // Pagar a fatura quita cada compra dela — sem isso, as parcelas
      // continuavam "Pendente" pra sempre mesmo com a fatura já paga.
      const items = await tx.transaction.findMany({
        where: { invoiceId: id, status: { not: 'CANCELED' } },
        select: { id: true, amount: true },
      });
      await Promise.all(
        items.map((it) =>
          tx.transaction.update({
            where: { id: it.id },
            data: { status: 'PAID', paidDate: isoToDbDate(body.paidDate), paidAmount: it.amount },
          }),
        ),
      );

      return this.present(updated);
    });
  }

  private present(i: any, verifiedTotal?: number) {
    return {
      id: i.id,
      creditCardId: i.creditCardId,
      referenceMonth: dbDateToIso(i.referenceMonth),
      periodStart: dbDateToIso(i.periodStart),
      periodEnd: dbDateToIso(i.periodEnd),
      closingDate: dbDateToIso(i.closingDate),
      dueDate: dbDateToIso(i.dueDate),
      status: i.status,
      total: verifiedTotal ?? nb(i.total),
      paidTransactionId: i.paidTransactionId,
    };
  }
}
