import { Prisma } from '@prisma/client';
import type { PrismaClient, TransactionType } from '@prisma/client';
import {
  addMonths,
  type AccountEntryBody,
  type CardEntryBody,
  type CreateTransactionBody,
  distribute,
  INFLOW_TYPES,
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
    await this.assertPlace(userId, body.placeId);

    const type = body.direction === 'expense' ? 'EXPENSE' : 'INCOME';
    const today = todaySP();
    const remind = {
      remindTelegram: body.remindTelegram ?? false,
      remindDaysBefore: body.remindDaysBefore ?? 1,
    };
    const extras = {
      notes: body.notes || null,
      tags: body.tags ?? [],
      placeId: body.placeId || null,
    };

    // Toda despesa/receita guarda 2 datas: competência (`date`) e pagamento
    // (`paymentDate`). Sem `paymentDate` informado, o pagamento planejado cai
    // na própria competência.
    const paymentIso = body.paymentDate ?? body.date;

    return this.db.$transaction(async (tx) => {
      // ---- lançamento único ----
      if (body.recurrence.mode === 'none') {
        const row = await tx.transaction.create({
          data: {
            userId,
            type,
            amount: numToBig(body.amount),
            paidAmount: numToBig(body.paid ? body.amount : 0),
            description: body.description,
            competenceDate: isoToDbDate(body.date),
            dueDate: isoToDbDate(paymentIso),
            paidDate: body.paid ? isoToDbDate(paymentIso) : null,
            status: statusFor(body.paid, paymentIso, today),
            accountId: body.accountId,
            categoryId: body.categoryId || null,
            ...remind,
            ...extras,
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
          const dueIso = paidThis ? paymentIso : date;
          rows.push(
            await tx.transaction.create({
              data: {
                userId,
                type,
                amount: numToBig(parts[i]!),
                paidAmount: numToBig(paidThis ? parts[i]! : 0),
                description: `${body.description} (${i + 1}/${n})`,
                competenceDate: isoToDbDate(date),
                dueDate: isoToDbDate(dueIso),
                paidDate: paidThis ? isoToDbDate(paymentIso) : null,
                status: statusFor(paidThis, dueIso, today),
                accountId: body.accountId,
                categoryId: body.categoryId || null,
                recurrenceId: rec.id,
                installmentGroupId: groupId,
                installmentNumber: i + 1,
                installmentTotal: n,
                ...remind,
                ...extras,
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
              paidAmount: numToBig(paidThis ? body.amount : 0),
              description: body.description,
              competenceDate: isoToDbDate(date),
              dueDate: isoToDbDate(paidThis ? paymentIso : date),
              paidDate: paidThis ? isoToDbDate(paymentIso) : null,
              // Recorrência FIXA nasce sempre PENDENTE (nunca AGENDADO): o
              // usuário confirma cada pagamento informando data e valor.
              status: paidThis ? 'PAID' : 'PENDING',
              accountId: body.accountId,
              categoryId: body.categoryId || null,
              recurrenceId: rec.id,
              ...remind,
              ...extras,
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
    await this.assertPlace(userId, body.placeId);
    const extras = {
      notes: body.notes || null,
      tags: body.tags ?? [],
      placeId: body.placeId || null,
    };

    const cycle = { closingDay: card.closingDay, dueDay: card.dueDay };
    const placements = invoicesForInstallments(body.purchaseDate, body.installments, cycle);
    // `amount` pode ser o TOTAL da compra (padrão) ou o valor de CADA parcela.
    const total = body.amountIsPerInstallment ? body.amount * body.installments : body.amount;
    const parts = distribute(total, body.installments);
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
            // A parcela "conta" no mês em que a fatura vence (não no mês da compra),
            // para aparecer no mês certo nas listas e no dashboard.
            competenceDate: invoice.dueDate,
            dueDate: invoice.dueDate,
            paidDate: null,
            status: 'PENDING',
            creditCardId: card.id,
            invoiceId: invoice.id,
            categoryId: body.categoryId || null,
            installmentGroupId: groupId,
            installmentNumber: i + 1,
            installmentTotal: body.installments,
            ...extras,
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
  /** Monta o `where` de listagem a partir dos filtros (reusado no export CSV). */
  private listWhere(
    scope: { userId?: string },
    q: Omit<ListTransactionsQuery, 'page' | 'pageSize'>,
  ): Prisma.TransactionWhereInput {
    const EXPENSE_FLOW: TransactionType[] = [
      'EXPENSE',
      'CARD_EXPENSE',
      'INVOICE_PAYMENT',
      'LOAN_INSTALLMENT',
    ];
    const INCOME_FLOW: TransactionType[] = ['INCOME', 'LOAN_DISBURSEMENT'];

    // categoria: subcategoria específica > categoria-pai (inclui filhas)
    let categoryFilter: Prisma.TransactionWhereInput = {};
    if (q.subcategoryId) {
      categoryFilter = { categoryId: q.subcategoryId };
    } else if (q.categoryId) {
      categoryFilter = {
        OR: [{ categoryId: q.categoryId }, { category: { parentId: q.categoryId } }],
      };
    }

    return {
      ...(scope.userId ? { userId: scope.userId } : {}),
      ...(q.accountId ? { accountId: q.accountId } : {}),
      ...(q.creditCardId ? { creditCardId: q.creditCardId } : {}),
      ...(q.placeId ? { placeId: q.placeId } : {}),
      ...(q.tag ? { tags: { has: q.tag } } : {}),
      ...categoryFilter,
      ...(q.type
        ? { type: q.type }
        : q.flow === 'expense'
          ? { type: { in: EXPENSE_FLOW } }
          : q.flow === 'income'
            ? { type: { in: INCOME_FLOW } }
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
  }

  /** Traduz `sortBy`/`sortDir` no `orderBy` do Prisma (com desempate estável). */
  private listOrderBy(q: ListTransactionsQuery): Prisma.TransactionOrderByWithRelationInput[] {
    const dir: Prisma.SortOrder = q.sortDir ?? 'desc';
    const primary: Prisma.TransactionOrderByWithRelationInput =
      q.sortBy === 'amount'
        ? { amount: dir }
        : q.sortBy === 'description'
          ? { description: dir }
          : q.sortBy === 'status'
            ? { status: dir }
            : q.sortBy === 'dueDate'
              ? { dueDate: dir }
              : q.sortBy === 'paidDate'
                ? { paidDate: dir }
                : q.sortBy === 'competenceDate'
                  ? { competenceDate: dir }
                  : q.sortBy === 'account'
                    ? { account: { name: dir } }
                    : q.sortBy === 'category'
                      ? { category: { name: dir } }
                      : { createdAt: dir };
    return [primary, { createdAt: dir }, { id: 'desc' }];
  }

  async list(scope: { userId?: string }, q: ListTransactionsQuery) {
    const where = this.listWhere(scope, q);
    const [rows, total, grouped] = await Promise.all([
      this.db.transaction.findMany({
        where,
        orderBy: this.listOrderBy(q),
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.transaction.count({ where }),
      // Totais do conjunto FILTRADO inteiro (não só a página) — rodapé da tela.
      this.db.transaction.groupBy({
        by: ['type'],
        where,
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    let income = 0;
    let expense = 0;
    let incomeCount = 0;
    let expenseCount = 0;
    for (const g of grouped) {
      const sum = nb(g._sum.amount);
      if (INFLOW_TYPES.includes(g.type)) {
        income += sum;
        incomeCount += g._count._all;
      } else {
        expense += sum;
        expenseCount += g._count._all;
      }
    }

    return {
      data: rows.map((r) => this.present(r)),
      page: q.page,
      pageSize: q.pageSize,
      total,
      totals: { count: total, incomeCount, expenseCount, income, expense, net: income - expense },
    };
  }

  /** Exporta os lançamentos que casam com os filtros como CSV (pt-BR, ';'). */
  async exportCsv(
    scope: { userId?: string },
    q: Omit<ListTransactionsQuery, 'page' | 'pageSize'>,
  ): Promise<string> {
    const rows = await this.db.transaction.findMany({
      where: this.listWhere(scope, q),
      orderBy: [{ competenceDate: 'desc' }, { createdAt: 'desc' }],
      take: 5000,
      include: {
        account: { select: { name: true } },
        category: { select: { name: true } },
        creditCard: { select: { name: true } },
      },
    });

    const STATUS: Record<string, string> = {
      PENDING: 'Pendente',
      SCHEDULED: 'Agendado',
      PARTIAL: 'Parcial',
      PAID: 'Pago',
      CANCELED: 'Cancelado',
    };
    const esc = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const header = ['data', 'tipo', 'descricao', 'valor', 'conta', 'cartao', 'categoria', 'status', 'pago_em'];
    const lines = rows.map((r) => {
      const signed = INFLOW_TYPES.includes(r.type) ? nb(r.amount) : -nb(r.amount);
      return [
        dbDateToIso(r.competenceDate),
        r.type,
        r.description,
        (signed / 100).toFixed(2).replace('.', ','),
        r.account?.name ?? '',
        r.creditCard?.name ?? '',
        r.category?.name ?? '',
        STATUS[r.status] ?? r.status,
        r.paidDate ? dbDateToIso(r.paidDate) : '',
      ]
        .map((c) => esc(String(c)))
        .join(';');
    });
    return `﻿${header.join(';')}\r\n${lines.join('\r\n')}\r\n`;
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

    // ---- edição de série (forward / all) ----
    // Propaga só campos "de template": descrição, categoria, conta e — apenas
    // para séries FIXAS — o valor (em INSTALLMENT o valor por parcela vem de
    // distribute() e não pode ser sobrescrito em bloco). Data/status/pagamento
    // continuam por ocorrência.
    if (body.scope !== 'one' && current.recurrenceId) {
      await this.assertPlace(current.userId, body.placeId || undefined);
      const rec = await this.db.recurrence.findUnique({ where: { id: current.recurrenceId } });
      const canAmount = rec?.mode === 'FIXED';
      const seriesData = {
        description: body.description,
        categoryId: body.categoryId === '' ? null : body.categoryId,
        accountId: body.accountId,
        placeId: body.placeId === '' ? null : body.placeId,
        ...(canAmount && body.amount != null ? { amount: numToBig(body.amount) } : {}),
      };
      await this.db.transaction.updateMany({
        where: {
          recurrenceId: current.recurrenceId,
          status: { not: 'CANCELED' },
          ...(body.scope === 'forward' ? { competenceDate: { gte: current.competenceDate } } : {}),
        },
        data: seriesData,
      });
      if (rec) {
        await this.db.recurrence.update({
          where: { id: rec.id },
          data: {
            description: body.description ?? undefined,
            categoryId: body.categoryId === '' ? null : (body.categoryId ?? undefined),
            accountId: body.accountId ?? undefined,
            ...(canAmount && body.amount != null ? { amount: numToBig(body.amount) } : {}),
          },
        });
      }
      const fresh = await this.db.transaction.findUniqueOrThrow({ where: { id } });
      return this.present(fresh);
    }

    if (body.categoryId) await this.assertCategory(current.userId, body.categoryId);
    if (body.placeId) await this.assertPlace(current.userId, body.placeId);

    // Cartão parcelado: mudar a data de uma parcela remaneja TODAS as parcelas
    // do grupo (e as move para a fatura certa).
    if (
      body.date &&
      current.type === 'CARD_EXPENSE' &&
      current.installmentGroupId &&
      dbDateToIso(current.competenceDate) !== body.date
    ) {
      return this.remapCardInstallmentDates(current, body);
    }

    const row = await this.db.transaction.update({
      where: { id },
      data: {
        description: body.description,
        amount: body.amount != null ? numToBig(body.amount) : undefined,
        competenceDate: body.date ? isoToDbDate(body.date) : undefined,
        // `dueDate` explícito manda; senão acompanha a competência quando ela muda.
        dueDate: body.dueDate
          ? isoToDbDate(body.dueDate)
          : body.date
            ? isoToDbDate(body.date)
            : undefined,
        categoryId: body.categoryId === '' ? null : body.categoryId,
        accountId: body.accountId,
        status: body.status,
        paidDate:
          body.paidDate === null ? null : body.paidDate ? isoToDbDate(body.paidDate) : undefined,
        paidAmount: body.paidAmount != null ? numToBig(body.paidAmount) : undefined,
        notes: body.notes,
        tags: body.tags,
        placeId: body.placeId === '' ? null : body.placeId,
      },
    });
    if (row.invoiceId) await recalcInvoiceTotal(this.db, row.invoiceId);
    return this.present(row);
  }

  /**
   * Recalcula a fatura/vencimento de cada parcela de uma compra parcelada no
   * cartão a partir da nova data. `body.date` é a nova competência da parcela
   * editada; as demais deslizam pela mesma âncora.
   */
  private async remapCardInstallmentDates(
    current: { id: string; userId: string; installmentGroupId: string | null; installmentNumber: number | null; creditCardId: string | null },
    body: UpdateTransactionBody,
  ) {
    const card = await this.db.creditCard.findFirst({
      where: { id: current.creditCardId ?? '', userId: current.userId },
    });
    if (!card) throw Errors.badRequest('Cartão inválido');
    const cycle = { closingDay: card.closingDay, dueDay: card.dueDay };

    const items = await this.db.transaction.findMany({
      where: { userId: current.userId, installmentGroupId: current.installmentGroupId! },
      orderBy: { installmentNumber: 'asc' },
    });
    if (items.length === 0) throw Errors.notFound('Parcelas');

    // Âncora = data da 1ª parcela, derivada da nova data da parcela editada.
    const editedIdx = Math.max(0, (current.installmentNumber ?? 1) - 1);
    const anchor = addMonths(body.date!, -editedIdx);
    const placements = invoicesForInstallments(anchor, items.length, cycle);

    const touchedInvoices = new Set<string>(
      items.map((it) => it.invoiceId).filter((v): v is string => !!v),
    );

    const rows = await this.db.$transaction(async (tx) => {
      const out = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        const placement = placements[i]!;
        const invoice = await ensureInvoice(tx, {
          userId: current.userId,
          creditCardId: card.id,
          referenceMonth: placement.referenceMonth,
          cycle,
        });
        touchedInvoices.add(invoice.id);
        out.push(
          await tx.transaction.update({
            where: { id: it.id },
            data: {
              competenceDate: invoice.dueDate,
              dueDate: invoice.dueDate,
              invoiceId: invoice.id,
            },
          }),
        );
      }
      return out;
    });

    for (const invId of touchedInvoices) await recalcInvoiceTotal(this.db, invId);
    const mine = rows.find((r) => r.id === current.id) ?? rows[0]!;
    return this.present(mine);
  }

  /** Pula/cancela uma ocorrência (ex.: "esse mês não teve"). */
  async skip(scope: { userId?: string }, id: string) {
    const current = await this.db.transaction.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
    });
    if (!current) throw Errors.notFound('Lançamento');
    if (current.status === 'PAID') throw Errors.badRequest('Lançamento já foi pago.');
    const row = await this.db.transaction.update({ where: { id }, data: { status: 'CANCELED' } });
    if (row.invoiceId) await recalcInvoiceTotal(this.db, row.invoiceId);
    return this.present(row);
  }

  /** Liquida vários lançamentos na mesma data (quita por completo). */
  async bulkPay(scope: { userId?: string }, ids: string[], paidDate: string) {
    const rows = await this.db.transaction.findMany({
      where: {
        id: { in: ids },
        ...(scope.userId ? { userId: scope.userId } : {}),
        status: { in: ['PENDING', 'SCHEDULED', 'PARTIAL'] },
      },
      select: { id: true, invoiceId: true },
    });
    if (rows.length === 0) return { paid: 0 };
    const paidIds = rows.map((r) => r.id);
    await this.db.transaction.updateMany({
      where: { id: { in: paidIds } },
      data: { status: 'PAID', paidDate: isoToDbDate(paidDate) },
    });
    // quita: paidAmount passa a valer o total (não dá pra referenciar coluna no updateMany)
    await this.db.$executeRaw`UPDATE "transactions" SET "paidAmount" = "amount" WHERE "id" IN (${Prisma.join(paidIds)})`;
    const invoiceIds = [...new Set(rows.map((r) => r.invoiceId).filter((v): v is string => !!v))];
    for (const invId of invoiceIds) await recalcInvoiceTotal(this.db, invId);
    return { paid: rows.length };
  }

  /**
   * Liquida um lançamento. Sem `body.amount` (ou com valor >= saldo devedor)
   * quita de vez (status PAID). Com valor menor, registra pagamento PARCIAL:
   * soma em `paidAmount` e mantém o status PARTIAL até quitar.
   */
  async markPaid(scope: { userId?: string }, id: string, body: MarkPaidBody) {
    const current = await this.db.transaction.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
    });
    if (!current) throw Errors.notFound('Lançamento');
    if (current.status === 'PAID') throw Errors.badRequest('Lançamento já está quitado.');

    const total = nb(current.amount);
    const already = nb(current.paidAmount);
    const owed = Math.max(total - already, 0);
    const pay = body.amount != null ? body.amount : owed;
    if (pay <= 0) throw Errors.badRequest('Informe um valor de pagamento maior que zero.');

    const newPaid = Math.min(already + pay, total);
    const quitado = body.amount == null || newPaid >= total;

    const row = await this.db.transaction.update({
      where: { id },
      data: {
        status: quitado ? 'PAID' : 'PARTIAL',
        paidAmount: numToBig(quitado ? total : newPaid),
        paidDate: isoToDbDate(body.paidDate),
        accountId: body.accountId ?? current.accountId,
      },
    });
    if (row.invoiceId) await recalcInvoiceTotal(this.db, row.invoiceId);
    return this.present(row);
  }

  async markUnpaid(scope: { userId?: string }, id: string) {
    const current = await this.db.transaction.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
    });
    if (!current) throw Errors.notFound('Lançamento');
    const today = todaySP();
    // Recorrência FIXA volta sempre para PENDENTE (nunca AGENDADO).
    let fixed = false;
    if (current.recurrenceId) {
      const rec = await this.db.recurrence.findUnique({
        where: { id: current.recurrenceId },
        select: { mode: true },
      });
      fixed = rec?.mode === 'FIXED';
    }
    const row = await this.db.transaction.update({
      where: { id },
      data: {
        status:
          !fixed && dbDateToIso(current.dueDate) > today ? 'SCHEDULED' : 'PENDING',
        paidDate: null,
        paidAmount: numToBig(0),
      },
    });
    if (row.invoiceId) await recalcInvoiceTotal(this.db, row.invoiceId);
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

    // scope 'group' numa recorrência FIXA/parcelada avulsa: apaga a série toda
    // (todas as ocorrências) e a própria regra de recorrência.
    if (scope === 'group' && current.recurrenceId) {
      const affected = await this.db.transaction.findMany({
        where: { userId: ownerId, recurrenceId: current.recurrenceId },
        select: { id: true, invoiceId: true },
      });
      await this.db.transaction.deleteMany({
        where: { userId: ownerId, recurrenceId: current.recurrenceId },
      });
      await this.db.recurrence
        .delete({ where: { id: current.recurrenceId } })
        .catch(() => undefined);
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
  /** Categoria agora é opcional — só valida quando informada. */
  private async assertCategory(userId: string, categoryId?: string | null) {
    if (!categoryId) return;
    const ok = await this.db.category.findFirst({ where: { id: categoryId, userId }, select: { id: true } });
    if (!ok) throw Errors.badRequest('Categoria inválida');
  }
  private async assertPlace(userId: string, placeId?: string | null) {
    if (!placeId) return;
    const ok = await this.db.place.findFirst({ where: { id: placeId, userId }, select: { id: true } });
    if (!ok) throw Errors.badRequest('Local de compra inválido');
  }

  private present(r: any) {
    return {
      id: r.id,
      type: r.type,
      status: r.status,
      amount: nb(r.amount),
      paidAmount: nb(r.paidAmount ?? 0),
      description: r.description,
      notes: r.notes ?? null,
      tags: r.tags ?? [],
      placeId: r.placeId ?? null,
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
