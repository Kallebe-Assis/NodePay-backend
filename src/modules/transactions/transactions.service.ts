import type { Prisma, PrismaClient } from '@prisma/client';
import {
  addMonths,
  type AccountEntryBody,
  type CardEntryBody,
  type CreateTransactionBody,
  distribute,
  invoicesForInstallments,
  type ListTransactionsQuery,
  type MarkPaidBody,
  type TransferBody,
  todaySP,
  type UpdateTransactionBody,
} from '@nodepay/shared';
import { Errors } from '../../lib/errors.js';
import { nb, numToBig } from '../../lib/money.js';
import { dbDateToIso, isoToDbDate } from '../../lib/date.js';
import { ensureInvoice, recalcInvoiceTotal } from '../invoices/invoice.helpers.js';

/** Quantos meses à frente materializamos uma recorrência FIXA na criação. */
const FIXED_HORIZON_MONTHS = 12;

export class TransactionsService {
  constructor(private readonly db: PrismaClient) {}

  // ---------------------------------------------------------------------------
  // CREATE (roteia pelo tipo de tela)
  // ---------------------------------------------------------------------------
  async create(userId: string, body: CreateTransactionBody) {
    switch (body.kind) {
      case 'account':
        return this.createAccountEntry(userId, body);
      case 'card':
        return this.createCardEntry(userId, body);
      case 'transfer':
        return this.createTransfer(userId, body);
    }
  }

  /** Tela 1 — despesa/receita em conta, com recorrência opcional. */
  private async createAccountEntry(userId: string, body: AccountEntryBody) {
    await this.assertAccount(userId, body.accountId);
    await this.assertCategory(userId, body.categoryId);

    const type = body.direction === 'expense' ? 'EXPENSE' : 'INCOME';
    const today = todaySP();
    const remind = {
      remindTelegram: body.remindTelegram ?? false,
      remindDaysBefore: body.remindDaysBefore ?? 1,
    };

    return this.db.$transaction(async (tx) => {
      // ---- lançamento único ----
      if (body.recurrence.mode === 'none') {
        const row = await tx.transaction.create({
          data: {
            userId,
            type,
            amount: numToBig(body.amount),
            description: body.description,
            competenceDate: isoToDbDate(body.date),
            dueDate: isoToDbDate(body.date),
            paidDate: body.paid ? isoToDbDate(body.date) : null,
            status: statusFor(body.paid, body.date, today),
            accountId: body.accountId,
            categoryId: body.categoryId,
            ...remind,
          },
        });
        return { created: 1, transactions: [this.present(row)] };
      }

      // ---- parcelado (avulso, não é cartão) ----
      if (body.recurrence.mode === 'INSTALLMENT') {
        const n = body.recurrence.installments;
        const parts = distribute(body.amount, n);
        const rec = await tx.recurrence.create({
          data: {
            userId,
            mode: 'INSTALLMENT',
            frequency: 'MONTHLY',
            interval: 1,
            occurrences: n,
            startDate: isoToDbDate(body.date),
            endDate: isoToDbDate(addMonths(body.date, n - 1)),
            type,
            direction: body.direction,
            amount: numToBig(body.amount),
            description: body.description,
            accountId: body.accountId,
            categoryId: body.categoryId,
            materializedUntil: isoToDbDate(addMonths(body.date, n - 1)),
          },
        });
        const groupId = rec.id;
        const rows = [];
        for (let i = 0; i < n; i++) {
          const date = addMonths(body.date, i);
          const paidThis = body.paid && i === 0;
          rows.push(
            await tx.transaction.create({
              data: {
                userId,
                type,
                amount: numToBig(parts[i]!),
                description: `${body.description} (${i + 1}/${n})`,
                competenceDate: isoToDbDate(date),
                dueDate: isoToDbDate(date),
                paidDate: paidThis ? isoToDbDate(date) : null,
                status: statusFor(paidThis, date, today),
                accountId: body.accountId,
                categoryId: body.categoryId,
                recurrenceId: rec.id,
                installmentGroupId: groupId,
                installmentNumber: i + 1,
                installmentTotal: n,
                ...remind,
              },
            }),
          );
        }
        return { created: n, recurrenceId: rec.id, transactions: rows.map((r) => this.present(r)) };
      }

      // ---- fixo (sem data fim): materializa 12 meses ----
      const rec = await tx.recurrence.create({
        data: {
          userId,
          mode: 'FIXED',
          frequency: body.recurrence.frequency,
          interval: 1,
          dayOfMonth: Number(body.date.slice(8, 10)),
          startDate: isoToDbDate(body.date),
          type,
          direction: body.direction,
          amount: numToBig(body.amount),
          description: body.description,
          accountId: body.accountId,
          categoryId: body.categoryId,
          materializedUntil: isoToDbDate(addMonths(body.date, FIXED_HORIZON_MONTHS)),
        },
      });
      const rows = [];
      for (let i = 0; i <= FIXED_HORIZON_MONTHS; i++) {
        const date = addMonths(body.date, i);
        const paidThis = body.paid && i === 0;
        rows.push(
          await tx.transaction.create({
            data: {
              userId,
              type,
              amount: numToBig(body.amount),
              description: body.description,
              competenceDate: isoToDbDate(date),
              dueDate: isoToDbDate(date),
              paidDate: paidThis ? isoToDbDate(date) : null,
              status: statusFor(paidThis, date, today),
              accountId: body.accountId,
              categoryId: body.categoryId,
              recurrenceId: rec.id,
              ...remind,
            },
          }),
        );
      }
      return { created: rows.length, recurrenceId: rec.id, transactions: rows.map((r) => this.present(r)) };
    });
  }

  /** Tela 2 — compra no cartão de crédito, parcelada em N faturas. */
  private async createCardEntry(userId: string, body: CardEntryBody) {
    const card = await this.db.creditCard.findFirst({
      where: { id: body.creditCardId, userId },
    });
    if (!card) throw Errors.notFound('Cartão');
    await this.assertCategory(userId, body.categoryId);

    const cycle = { closingDay: card.closingDay, dueDay: card.dueDay };
    const placements = invoicesForInstallments(body.purchaseDate, body.installments, cycle);
    const parts = distribute(body.amount, body.installments);
    const groupId = `card_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return this.db.$transaction(async (tx) => {
      const rows = [];
      for (let i = 0; i < body.installments; i++) {
        const placement = placements[i]!;
        const invoice = await ensureInvoice(tx, {
          userId,
          creditCardId: card.id,
          referenceMonth: placement.referenceMonth,
          cycle,
        });
        const row = await tx.transaction.create({
          data: {
            userId,
            type: 'CARD_EXPENSE',
            amount: numToBig(parts[i]!),
            description:
              body.installments > 1
                ? `${body.description} (${i + 1}/${body.installments})`
                : body.description,
            competenceDate: isoToDbDate(body.purchaseDate),
            dueDate: invoice.dueDate,
            paidDate: null,
            status: 'PENDING',
            creditCardId: card.id,
            invoiceId: invoice.id,
            categoryId: body.categoryId,
            installmentGroupId: groupId,
            installmentNumber: i + 1,
            installmentTotal: body.installments,
          },
        });
        rows.push(row);
        await recalcInvoiceTotal(tx, invoice.id);
      }
      return { created: rows.length, installmentGroupId: groupId, transactions: rows.map((r) => this.present(r)) };
    });
  }

  /** Transferência entre contas (1 registro, 2 pontas). */
  private async createTransfer(userId: string, body: TransferBody) {
    if (body.fromAccountId === body.toAccountId) {
      throw Errors.badRequest('Conta de origem e destino devem ser diferentes');
    }
    await this.assertAccount(userId, body.fromAccountId);
    await this.assertAccount(userId, body.toAccountId);
    const today = todaySP();
    const row = await this.db.transaction.create({
      data: {
        userId,
        type: 'TRANSFER',
        amount: numToBig(body.amount),
        description: body.description,
        competenceDate: isoToDbDate(body.date),
        dueDate: isoToDbDate(body.date),
        paidDate: body.paid ? isoToDbDate(body.date) : null,
        status: statusFor(body.paid, body.date, today),
        accountId: body.fromAccountId,
        transferToAccountId: body.toAccountId,
        transferGroupId: `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      },
    });
    return { created: 1, transactions: [this.present(row)] };
  }

  // ---------------------------------------------------------------------------
  // READ
  // ---------------------------------------------------------------------------
  async list(scope: { userId?: string }, q: ListTransactionsQuery) {
    const EXPENSE_FLOW = ['EXPENSE', 'CARD_EXPENSE', 'INVOICE_PAYMENT', 'LOAN_INSTALLMENT'];
    const INCOME_FLOW = ['INCOME', 'LOAN_DISBURSEMENT'];

    // categoria: subcategoria específica > categoria-pai (inclui filhas)
    let categoryFilter: Prisma.TransactionWhereInput = {};
    if (q.subcategoryId) {
      categoryFilter = { categoryId: q.subcategoryId };
    } else if (q.categoryId) {
      categoryFilter = {
        OR: [{ categoryId: q.categoryId }, { category: { parentId: q.categoryId } }],
      };
    }

    const where: Prisma.TransactionWhereInput = {
      ...(scope.userId ? { userId: scope.userId } : {}),
      ...(q.accountId ? { accountId: q.accountId } : {}),
      ...(q.creditCardId ? { creditCardId: q.creditCardId } : {}),
      ...categoryFilter,
      ...(q.type
        ? { type: q.type }
        : q.flow === 'expense'
          ? { type: { in: EXPENSE_FLOW as never[] } }
          : q.flow === 'income'
            ? { type: { in: INCOME_FLOW as never[] } }
            : // livro-razão comum não mostra transferências (elas têm tela própria);
              // o saldo das contas já é ajustado por computeBalances.
              { type: { not: 'TRANSFER' } }),
      ...(q.status ? { status: q.status } : {}),
      ...(q.minAmount != null || q.maxAmount != null
        ? {
            amount: {
              ...(q.minAmount != null ? { gte: BigInt(q.minAmount) } : {}),
              ...(q.maxAmount != null ? { lte: BigInt(q.maxAmount) } : {}),
            },
          }
        : {}),
      ...(q.search ? { description: { contains: q.search, mode: 'insensitive' } } : {}),
      ...(q.from || q.to
        ? {
            competenceDate: {
              ...(q.from ? { gte: isoToDbDate(q.from) } : {}),
              ...(q.to ? { lte: isoToDbDate(q.to) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.db.transaction.findMany({
        where,
        orderBy: [{ competenceDate: 'desc' }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.transaction.count({ where }),
    ]);

    return { data: rows.map((r) => this.present(r)), page: q.page, pageSize: q.pageSize, total };
  }

  async get(scope: { userId?: string }, id: string) {
    const row = await this.db.transaction.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
    });
    if (!row) throw Errors.notFound('Lançamento');
    return this.present(row);
  }

  // ---------------------------------------------------------------------------
  // UPDATE / STATUS / DELETE
  // ---------------------------------------------------------------------------
  async update(scope: { userId?: string }, id: string, body: UpdateTransactionBody) {
    const current = await this.db.transaction.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
    });
    if (!current) throw Errors.notFound('Lançamento');
    if (body.scope !== 'one' && current.recurrenceId) {
      // TODO(fase 2): propagar edição para "forward" / "all" da série
      throw Errors.notImplemented('Edição de série (forward/all)');
    }

    const row = await this.db.transaction.update({
      where: { id },
      data: {
        description: body.description,
        amount: body.amount != null ? numToBig(body.amount) : undefined,
        competenceDate: body.date ? isoToDbDate(body.date) : undefined,
        dueDate: body.date ? isoToDbDate(body.date) : undefined,
        categoryId: body.categoryId,
        accountId: body.accountId,
        status: body.status,
        paidDate:
          body.paidDate === null ? null : body.paidDate ? isoToDbDate(body.paidDate) : undefined,
      },
    });
    if (row.invoiceId) await recalcInvoiceTotal(this.db, row.invoiceId);
    return this.present(row);
  }

  async markPaid(scope: { userId?: string }, id: string, body: MarkPaidBody) {
    const current = await this.db.transaction.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
    });
    if (!current) throw Errors.notFound('Lançamento');
    const row = await this.db.transaction.update({
      where: { id },
      data: {
        status: 'PAID',
        paidDate: isoToDbDate(body.paidDate),
        accountId: body.accountId ?? current.accountId,
      },
    });
    return this.present(row);
  }

  async markUnpaid(scope: { userId?: string }, id: string) {
    const current = await this.db.transaction.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
    });
    if (!current) throw Errors.notFound('Lançamento');
    const today = todaySP();
    const row = await this.db.transaction.update({
      where: { id },
      data: {
        status: dbDateToIso(current.dueDate) > today ? 'SCHEDULED' : 'PENDING',
        paidDate: null,
      },
    });
    return this.present(row);
  }

  async remove(
    ownerScope: { userId?: string },
    id: string,
    scope: 'one' | 'group' = 'one',
  ) {
    const current = await this.db.transaction.findFirst({
      where: { id, ...(ownerScope.userId ? { userId: ownerScope.userId } : {}) },
    });
    if (!current) throw Errors.notFound('Lançamento');
    const ownerId = current.userId;

    if (scope === 'group' && current.installmentGroupId) {
      const affected = await this.db.transaction.findMany({
        where: { userId: ownerId, installmentGroupId: current.installmentGroupId },
        select: { id: true, invoiceId: true },
      });
      await this.db.transaction.deleteMany({
        where: { userId: ownerId, installmentGroupId: current.installmentGroupId },
      });
      const invoiceIds = [...new Set(affected.map((a) => a.invoiceId).filter(Boolean))] as string[];
      for (const inv of invoiceIds) await recalcInvoiceTotal(this.db, inv);
      return { deleted: affected.length };
    }

    await this.db.transaction.delete({ where: { id } });
    if (current.invoiceId) await recalcInvoiceTotal(this.db, current.invoiceId);
    return { deleted: 1 };
  }

  // ---------------------------------------------------------------------------
  private async assertAccount(userId: string, accountId: string) {
    const ok = await this.db.account.findFirst({ where: { id: accountId, userId }, select: { id: true } });
    if (!ok) throw Errors.badRequest('Conta inválida');
  }
  private async assertCategory(userId: string, categoryId: string) {
    const ok = await this.db.category.findFirst({ where: { id: categoryId, userId }, select: { id: true } });
    if (!ok) throw Errors.badRequest('Categoria inválida');
  }

  private present(r: any) {
    return {
      id: r.id,
      type: r.type,
      status: r.status,
      amount: nb(r.amount),
      description: r.description,
      competenceDate: dbDateToIso(r.competenceDate),
      dueDate: dbDateToIso(r.dueDate),
      paidDate: r.paidDate ? dbDateToIso(r.paidDate) : null,
      accountId: r.accountId,
      creditCardId: r.creditCardId,
      invoiceId: r.invoiceId,
      categoryId: r.categoryId,
      recurrenceId: r.recurrenceId,
      installmentGroupId: r.installmentGroupId,
      installmentNumber: r.installmentNumber,
      installmentTotal: r.installmentTotal,
      loanId: r.loanId,
      transferGroupId: r.transferGroupId,
      transferToAccountId: r.transferToAccountId,
      remindTelegram: r.remindTelegram ?? false,
      remindDaysBefore: r.remindDaysBefore ?? 1,
      createdAt: r.createdAt.toISOString(),
    };
  }
}

function statusFor(paid: boolean, date: string, today: string): 'PAID' | 'SCHEDULED' | 'PENDING' {
  if (paid) return 'PAID';
  return date > today ? 'SCHEDULED' : 'PENDING';
}
