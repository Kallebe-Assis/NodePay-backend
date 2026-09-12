import { Prisma } from '@prisma/client';
import type { PrismaClient, TransactionType } from '@prisma/client';
import {
  addDays,
  addMonths,
  type AccountEntryBody,
  type CardEntryBody,
  type CreateTransactionBody,
  distribute,
  type IsoDate,
  INFLOW_TYPES,
  invoicesForInstallments,
  type ListTransactionsQuery,
  type MarkPaidBody,
  type RecurrenceFrequency,
  type TransferBody,
  todaySP,
  type UpdateTransactionBody,
} from '@nodepay/shared';
import { Errors } from '../../lib/errors.js';
import { nb, numToBig } from '../../lib/money.js';
import { dbDateToIso, isoToDbDate } from '../../lib/date.js';
import { ensureInvoice, recalcInvoiceTotal } from '../invoices/invoice.helpers.js';

/** Quantas ocorrências materializamos de saída (sem `occurrences` explícito) por frequência. */
const FIXED_HORIZON_MONTHS = 12; // mensal/anual: ~12 ocorrências à frente
const FIXED_HORIZON_WEEKS = 52; // semanal: ~52 ocorrências (1 ano) à frente

/** Campos mínimos de uma parcela (cartão ou avulsa) para remanejar datas. */
type InstallmentRow = {
  id: string;
  userId: string;
  installmentGroupId: string | null;
  installmentNumber: number | null;
  creditCardId: string | null;
};

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
      includeInTotals: body.includeInTotals,
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
        // parcela inicial: pra registrar uma dívida que já tinha parcelas
        // pagas ANTES de existir no NodePay — só cria a partir dela.
        const start = Math.min(body.recurrence.startInstallment ?? 1, n);
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
        for (let i = start - 1; i < n; i++) {
          const date = addMonths(body.date, i);
          const paidThis = body.paid && i === start - 1;
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
        return { created: rows.length, recurrenceId: rec.id, transactions: rows.map((r) => this.present(r)) };
      }

      // ---- fixo (semanal/mensal/anual — com ou sem quantidade definida) ----
      const freq = body.recurrence.frequency;
      const step = (d: IsoDate) => stepByFrequency(d, freq);
      const requestedCount = body.recurrence.occurrences;
      // sem quantidade pedida: materializa o horizonte de sempre (o job diário
      // estende quando o tempo passa); com quantidade: gera só essas e trava
      // (endDate) pra o job não continuar depois.
      const count = requestedCount ?? (freq === 'WEEKLY' ? FIXED_HORIZON_WEEKS : FIXED_HORIZON_MONTHS) + 1;

      const dates: IsoDate[] = [];
      let cursor = body.date;
      for (let i = 0; i < count; i++) {
        dates.push(cursor);
        cursor = step(cursor);
      }
      const lastDate = dates[dates.length - 1]!;

      const rec = await tx.recurrence.create({
        data: {
          userId,
          mode: 'FIXED',
          frequency: freq,
          interval: 1,
          dayOfMonth: freq === 'MONTHLY' ? Number(body.date.slice(8, 10)) : null,
          startDate: isoToDbDate(body.date),
          endDate: requestedCount ? isoToDbDate(lastDate) : null,
          occurrences: requestedCount ?? null,
          type,
          direction: body.direction,
          amount: numToBig(body.amount),
          description: body.description,
          accountId: body.accountId,
          categoryId: body.categoryId,
          materializedUntil: isoToDbDate(lastDate),
        },
      });
      const rows = [];
      for (let i = 0; i < dates.length; i++) {
        const date = dates[i]!;
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
      includeInTotals: body.includeInTotals,
    };

    const cycle = { closingDay: card.closingDay, dueDay: card.dueDay };
    const placements = invoicesForInstallments(body.purchaseDate, body.installments, cycle);
    // `amount` pode ser o TOTAL da compra (padrão) ou o valor de CADA parcela.
    const total = body.amountIsPerInstallment ? body.amount * body.installments : body.amount;
    const parts = distribute(total, body.installments);
    const groupId = `card_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // parcela inicial: pra registrar uma compra parcelada que já vinha de
    // antes do NodePay — só lança as faturas a partir dela.
    const start = Math.min(body.startInstallment ?? 1, body.installments);

    return this.db.$transaction(async (tx) => {
      const rows = [];
      for (let i = start - 1; i < body.installments; i++) {
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
            // A parcela "conta" no mês em que a fatura FECHA (não no da compra
            // nem no do vencimento) — é a competência da fatura para listas e
            // relatórios. `dueDate` continua sendo o vencimento real.
            competenceDate: invoice.closingDate,
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
    await this.assertCategory(userId, body.categoryId);
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
        categoryId: body.categoryId || null,
        transferFlow: body.transferFlow || null,
        includeInTotals: body.includeInTotals,
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
            : q.flow === 'card'
              ? { type: 'CARD_EXPENSE' }
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
      // Agrupa por tipo × status para tirar num só query: somas por sentido
      // (receita/despesa) e por status (pago/pendente/agendado).
      this.db.transaction.groupBy({
        by: ['type', 'status'],
        where,
        _sum: { amount: true, paidAmount: true },
        _count: { _all: true },
      }),
    ]);

    let income = 0;
    let expense = 0;
    let incomeCount = 0;
    let expenseCount = 0;
    let paid = 0;
    let pending = 0;
    let scheduled = 0;
    for (const g of grouped) {
      const sum = nb(g._sum.amount);
      const paidPortion = nb(g._sum.paidAmount);
      const sign = INFLOW_TYPES.includes(g.type) ? 1 : -1;

      if (sign === 1) {
        income += sum;
        incomeCount += g._count._all;
      } else {
        expense += sum;
        expenseCount += g._count._all;
      }

      // resultado líquido por status (receita soma, despesa subtrai)
      if (g.status === 'PAID') {
        paid += sign * sum;
      } else if (g.status === 'PARTIAL') {
        paid += sign * paidPortion;
        pending += sign * (sum - paidPortion);
      } else if (g.status === 'SCHEDULED') {
        scheduled += sign * sum;
      } else if (g.status === 'PENDING') {
        pending += sign * sum;
      }
      // CANCELED não entra em nenhum bucket de status
    }

    return {
      data: rows.map((r) => this.present(r)),
      page: q.page,
      pageSize: q.pageSize,
      total,
      totals: {
        count: total,
        incomeCount,
        expenseCount,
        income,
        expense,
        net: income - expense,
        paid,
        pending,
        scheduled,
      },
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
    // distribute() e não pode ser sobrescrito em bloco). Status/pagamento/
    // observações/etiquetas continuam por ocorrência.
    if (body.scope !== 'one' && current.recurrenceId) {
      await this.assertPlace(current.userId, body.placeId || undefined);
      const rec = await this.db.recurrence.findUnique({ where: { id: current.recurrenceId } });
      const canAmount = rec?.mode === 'FIXED';

      // Recorrência FIXA + data mudou: remaneja a data de TODAS as ocorrências
      // em escopo (preservando o espaçamento semanal/mensal/anual a partir da
      // nova data desta), em vez de deixar as demais no lugar. Em INSTALLMENT
      // a data continua por ocorrência (o valor de cada parcela já vem de
      // distribute() com base no calendário original).
      if (rec?.mode === 'FIXED' && body.date && dbDateToIso(current.competenceDate) !== body.date) {
        return this.remapFixedSeriesDates(current, rec, body);
      }

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

    // Mudar a data de uma parcela (cartão ou avulsa): o front pergunta antes
    // se é só esta ou se remaneja o grupo todo (`body.applyToInstallments`).
    if (body.date && current.installmentGroupId && dbDateToIso(current.competenceDate) !== body.date) {
      if (body.applyToInstallments) {
        return current.type === 'CARD_EXPENSE'
          ? this.remapCardInstallmentDates(current, body)
          : this.remapAvulsoInstallmentDates(current, body);
      }
      if (current.type === 'CARD_EXPENSE') {
        return this.moveSingleCardInstallment(current, body);
      }
      // avulsa + "só esta parcela": segue pro update normal (1 linha) abaixo.
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
        includeInTotals: body.includeInTotals,
        transferFlow: body.transferFlow,
      },
    });
    if (row.invoiceId) await recalcInvoiceTotal(this.db, row.invoiceId);
    return this.present(row);
  }

  /** Campos "de conteúdo" que uma edição pode trazer junto com a mudança de data. */
  private otherFieldsFrom(body: UpdateTransactionBody) {
    return {
      description: body.description,
      amount: body.amount != null ? numToBig(body.amount) : undefined,
      categoryId: body.categoryId === '' ? null : body.categoryId,
      placeId: body.placeId === '' ? null : body.placeId,
      notes: body.notes,
      tags: body.tags,
    };
  }

  /**
   * Move só ESTA parcela do cartão para a fatura certa da nova data — as
   * demais parcelas do grupo continuam onde estavam.
   */
  private async moveSingleCardInstallment(
    current: InstallmentRow & { invoiceId: string | null },
    body: UpdateTransactionBody,
  ) {
    const card = await this.db.creditCard.findFirst({
      where: { id: current.creditCardId ?? '', userId: current.userId },
    });
    if (!card) throw Errors.badRequest('Cartão inválido');
    const cycle = { closingDay: card.closingDay, dueDay: card.dueDay };
    const placement = invoicesForInstallments(body.date!, 1, cycle)[0]!;
    const invoice = await ensureInvoice(this.db, {
      userId: current.userId,
      creditCardId: card.id,
      referenceMonth: placement.referenceMonth,
      cycle,
    });

    const row = await this.db.transaction.update({
      where: { id: current.id },
      data: {
        competenceDate: invoice.closingDate,
        dueDate: invoice.dueDate,
        invoiceId: invoice.id,
        ...this.otherFieldsFrom(body),
      },
    });
    if (current.invoiceId && current.invoiceId !== invoice.id) {
      await recalcInvoiceTotal(this.db, current.invoiceId);
    }
    await recalcInvoiceTotal(this.db, invoice.id);
    return this.present(row);
  }

  /**
   * Recalcula a fatura/vencimento de cada parcela de uma compra parcelada no
   * cartão a partir da nova data. `body.date` é a nova competência da parcela
   * editada; as demais deslizam pela mesma âncora.
   */
  private async remapCardInstallmentDates(current: InstallmentRow, body: UpdateTransactionBody) {
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
              competenceDate: invoice.closingDate, // competência = fechamento da fatura
              dueDate: invoice.dueDate,
              invoiceId: invoice.id,
              // as outras informações editadas (descrição, valor, categoria…)
              // valem só para a parcela que o usuário estava mesmo editando.
              ...(it.id === current.id ? this.otherFieldsFrom(body) : {}),
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

  /**
   * Mesma ideia de `remapCardInstallmentDates`, mas para um parcelamento
   * avulso (não-cartão): as parcelas não têm fatura, então só desliza a
   * competência/vencimento de cada uma preservando o espaçamento mensal a
   * partir da nova data da parcela editada. Parcelas já PAGAS não se mexem.
   */
  private async remapAvulsoInstallmentDates(current: InstallmentRow, body: UpdateTransactionBody) {
    const items = await this.db.transaction.findMany({
      where: { userId: current.userId, installmentGroupId: current.installmentGroupId! },
      orderBy: { installmentNumber: 'asc' },
    });
    if (items.length === 0) throw Errors.notFound('Parcelas');

    const editedIdx = Math.max(0, (current.installmentNumber ?? 1) - 1);
    const anchor = addMonths(body.date!, -editedIdx);

    const rows = await this.db.$transaction(async (tx) => {
      const out = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        if (it.status === 'PAID' && it.id !== current.id) {
          out.push(it);
          continue;
        }
        const newDate = isoToDbDate(addMonths(anchor, i));
        out.push(
          await tx.transaction.update({
            where: { id: it.id },
            data: {
              competenceDate: newDate,
              dueDate: newDate,
              ...(it.id === current.id ? this.otherFieldsFrom(body) : {}),
            },
          }),
        );
      }
      return out;
    });

    const mine = rows.find((r) => r.id === current.id) ?? rows[0]!;
    return this.present(mine);
  }

  /**
   * Edição em lote ("esta e as próximas" / "toda a série") de uma recorrência
   * FIXA em que a DATA também mudou: em vez de deixar as demais ocorrências
   * paradas, remaneja a data de todas as ocorrências em escopo preservando o
   * espaçamento da frequência (semanal/mensal/anual) a partir da nova data da
   * ocorrência editada. Ocorrências já PAGAS não têm a data mexida (histórico
   * não se reescreve) — só recebem os demais campos, como no fluxo normal.
   * Ao final, realinha `Recurrence.startDate`/`materializedUntil`/`endDate`
   * com as datas reais que sobraram, pra o job de materialização continuar
   * do lugar certo.
   */
  private async remapFixedSeriesDates(
    current: { id: string; userId: string; recurrenceId: string | null; competenceDate: Date },
    rec: { id: string; frequency: RecurrenceFrequency; interval: number; endDate: Date | null },
    body: UpdateTransactionBody,
  ) {
    const allItems = await this.db.transaction.findMany({
      where: { userId: current.userId, recurrenceId: rec.id, status: { not: 'CANCELED' } },
      orderBy: { competenceDate: 'asc' },
    });
    const editedIdx = allItems.findIndex((it) => it.id === current.id);
    if (editedIdx === -1) throw Errors.notFound('Ocorrência');

    const inScope = body.scope === 'all' ? allItems : allItems.slice(editedIdx);

    const seriesData = {
      description: body.description,
      categoryId: body.categoryId === '' ? null : body.categoryId,
      accountId: body.accountId,
      placeId: body.placeId === '' ? null : body.placeId,
      ...(body.amount != null ? { amount: numToBig(body.amount) } : {}),
    };

    const rows = await this.db.$transaction(async (tx) => {
      const out = [];
      for (const it of inScope) {
        const isEdited = it.id === current.id;
        const offset = allItems.indexOf(it) - editedIdx;
        const skipDate = it.status === 'PAID' && !isEdited;
        const newDate = isoToDbDate(stepByFrequencyN(body.date!, offset, rec.frequency, rec.interval));
        out.push(
          await tx.transaction.update({
            where: { id: it.id },
            data: {
              ...seriesData,
              ...(skipDate
                ? {}
                : {
                    competenceDate: newDate,
                    dueDate: isEdited && body.dueDate ? isoToDbDate(body.dueDate) : newDate,
                  }),
            },
          }),
        );
      }
      return out;
    });

    // realinha a recorrência com as datas reais que restaram (min/max)
    const agg = await this.db.transaction.aggregate({
      where: { recurrenceId: rec.id, status: { not: 'CANCELED' } },
      _min: { competenceDate: true },
      _max: { competenceDate: true },
    });
    if (agg._min.competenceDate && agg._max.competenceDate) {
      await this.db.recurrence.update({
        where: { id: rec.id },
        data: {
          startDate: agg._min.competenceDate,
          materializedUntil: agg._max.competenceDate,
          dayOfMonth:
            rec.frequency === 'MONTHLY' ? Number(dbDateToIso(agg._min.competenceDate).slice(8, 10)) : null,
          ...(rec.endDate ? { endDate: agg._max.competenceDate } : {}),
        },
      });
    }

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

    // Excluir o pagamento de uma fatura desfaz o pagamento: ela volta a ficar
    // em aberto (o frontend avisa/confirma isso antes de chamar o delete).
    if (current.type === 'INVOICE_PAYMENT') {
      const invoice = await this.db.invoice.findFirst({ where: { paidTransactionId: id } });
      if (invoice) {
        await this.db.invoice.update({
          where: { id: invoice.id },
          data: { status: 'OPEN', paidTransactionId: null },
        });
        await recalcInvoiceTotal(this.db, invoice.id);
      }
    }

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
      transferFlow: r.transferFlow ?? null,
      includeInTotals: r.includeInTotals ?? true,
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

/** Avança `d` um período de `frequency` (mesma regra do job `recurrences:materialize`). */
function stepByFrequency(d: IsoDate, frequency: RecurrenceFrequency): IsoDate {
  if (frequency === 'WEEKLY') return addDays(d, 7);
  if (frequency === 'YEARLY') return addMonths(d, 12);
  return addMonths(d, 1);
}

/** Avança (ou volta, se `n` for negativo) `d` em `n` períodos de `frequency`. */
function stepByFrequencyN(
  d: IsoDate,
  n: number,
  frequency: RecurrenceFrequency,
  interval = 1,
): IsoDate {
  if (n === 0) return d;
  const unit = frequency === 'WEEKLY' ? 7 * interval : frequency === 'YEARLY' ? 12 * interval : interval;
  return frequency === 'WEEKLY' ? addDays(d, unit * n) : addMonths(d, unit * n);
}
