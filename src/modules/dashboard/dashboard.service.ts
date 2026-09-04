import type { PrismaClient, TransactionType } from '@prisma/client';
import { addDays, addMonths, endOfMonth, type IsoDate, startOfMonth, todaySP } from '@nodepay/shared';
import { nb } from '../../lib/money.js';
import { dbDateToIso, isoToDbDate } from '../../lib/date.js';
import { computeBalances } from '../accounts/balance.js';

const OUT: TransactionType[] = ['EXPENSE', 'INVOICE_PAYMENT', 'LOAN_INSTALLMENT'];
const IN: TransactionType[] = ['INCOME', 'LOAN_DISBURSEMENT'];
const PENDING = ['PENDING', 'SCHEDULED'];

/** (atual − anterior) / |anterior|; null quando anterior = 0. */
function pct(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}

export class DashboardService {
  constructor(private readonly db: PrismaClient) {}

  async summary(userId: string, month?: string) {
    const anchor: IsoDate = (month ? `${month}-01` : todaySP().slice(0, 7) + '-01') as IsoDate;
    const from = startOfMonth(anchor);
    const to = endOfMonth(anchor);
    const today = todaySP();
    const inMonth = { gte: isoToDbDate(from), lte: isoToDbDate(to) };
    const prevFrom = startOfMonth(addMonths(anchor, -1));
    const prevTo = endOfMonth(addMonths(anchor, -1));
    // janela para o "gasto médio mensal" (últimos 90 dias liquidados)
    const runwayFrom = addDays(today, -90);

    const [txns, balances, categories, cards, openInvoices, prevAgg, recentOutflow] =
      await Promise.all([
        this.db.transaction.findMany({
          where: { userId, status: { not: 'CANCELED' }, competenceDate: inMonth },
          select: {
            type: true,
            amount: true,
            status: true,
            dueDate: true,
            paidDate: true,
            categoryId: true,
            recurrenceId: true,
            loanId: true,
            installmentGroupId: true,
          },
        }),
        computeBalances(this.db, { userId }, { dashboardOnly: true }),
        this.db.category.findMany({ where: { userId }, select: { id: true, name: true, color: true } }),
        this.db.creditCard.findMany({
          where: { userId, archived: false },
          select: { creditLimit: true },
        }),
        this.db.invoice.findMany({
          where: { userId, status: { in: ['OPEN', 'CLOSED'] } },
          select: { total: true, dueDate: true, status: true },
          orderBy: { dueDate: 'asc' },
        }),
        this.db.transaction.groupBy({
          by: ['type'],
          where: {
            userId,
            status: 'PAID',
            competenceDate: { gte: isoToDbDate(prevFrom), lte: isoToDbDate(prevTo) },
            type: { in: [...IN, ...OUT] },
          },
          _sum: { amount: true },
        }),
        this.db.transaction.aggregate({
          where: {
            userId,
            status: 'PAID',
            type: { in: OUT },
            paidDate: { gte: isoToDbDate(runwayFrom), lte: isoToDbDate(today) },
          },
          _sum: { amount: true },
        }),
      ]);

    let prevIncome = 0;
    let prevExpense = 0;
    for (const g of prevAgg) {
      if (IN.includes(g.type)) prevIncome += nb(g._sum.amount);
      if (OUT.includes(g.type)) prevExpense += nb(g._sum.amount);
    }

    const catName = new Map(categories.map((c) => [c.id, c]));

    let totalIncome = 0; // só PAID
    let totalExpense = 0; // só PAID
    let pendingIncome = 0;
    let pendingExpense = 0;
    let committed = 0;
    const byExpenseCat = new Map<string | null, number>();
    const byIncomeCat = new Map<string | null, number>();

    for (const t of txns) {
      const amt = nb(t.amount);
      const paid = t.status === 'PAID';
      if (IN.includes(t.type)) {
        if (paid) totalIncome += amt;
        else if (PENDING.includes(t.status)) pendingIncome += amt;
        byIncomeCat.set(t.categoryId, (byIncomeCat.get(t.categoryId) ?? 0) + amt);
      }
      if (OUT.includes(t.type)) {
        if (paid) totalExpense += amt;
        else if (PENDING.includes(t.status)) pendingExpense += amt;
        byExpenseCat.set(t.categoryId, (byExpenseCat.get(t.categoryId) ?? 0) + amt);
        if (t.recurrenceId || t.loanId || t.installmentGroupId) committed += amt;
      }
    }

    const totalCurrent = [...balances.values()].reduce((s, b) => s + b.currentBalance, 0);

    // ---- projeção do saldo dia a dia ----
    // Data efetiva do movimento: pagamento (se já liquidado até hoje) senão vencimento.
    const effDate = (t: (typeof txns)[number]) =>
      t.paidDate && dbDateToIso(t.paidDate) <= today ? dbDateToIso(t.paidDate) : dbDateToIso(t.dueDate);
    const signedOf = (t: (typeof txns)[number]) => {
      const amt = nb(t.amount);
      return IN.includes(t.type) ? amt : OUT.includes(t.type) ? -amt : 0;
    };

    const dailyDelta = new Map<string, number>();
    for (const t of txns) {
      dailyDelta.set(effDate(t), (dailyDelta.get(effDate(t)) ?? 0) + signedOf(t));
    }

    // `totalCurrent` já contém os movimentos do mês liquidados até hoje. Para a
    // linha começar do saldo do INÍCIO do mês (e não somar duas vezes), tiramos
    // esses movimentos e o loop os recoloca no dia certo.
    const realizedInMonthNet = txns
      .filter((t) => t.paidDate && dbDateToIso(t.paidDate) <= today && effDate(t) >= from)
      .reduce((s, t) => s + signedOf(t), 0);

    const cashflow = [];
    let running = totalCurrent - realizedInMonthNet;
    for (let d: IsoDate = from; d <= to; d = addDays(d, 1)) {
      const delta = dailyDelta.get(d) ?? 0;
      running += delta;
      const dayTx = txns.filter((t) => effDate(t) === d);
      cashflow.push({
        date: d,
        income: dayTx.filter((t) => IN.includes(t.type)).reduce((s, t) => s + nb(t.amount), 0),
        expense: dayTx.filter((t) => OUT.includes(t.type)).reduce((s, t) => s + nb(t.amount), 0),
        net: delta,
        projectedBalance: running,
      });
    }

    const upcomingBills = txns
      .filter(
        (t) =>
          OUT.includes(t.type) && PENDING.includes(t.status) && dbDateToIso(t.dueDate) >= today,
      )
      .reduce((s, t) => s + nb(t.amount), 0);

    const loanOutstanding = txns
      .filter((t) => t.type === 'LOAN_INSTALLMENT' && t.status !== 'PAID')
      .reduce((s, t) => s + nb(t.amount), 0);

    const breakdown = (m: Map<string | null, number>) => {
      const total = [...m.values()].reduce((s, v) => s + v, 0) || 1;
      return [...m.entries()]
        .map(([categoryId, val]) => ({
          categoryId,
          categoryName: categoryId
            ? (catName.get(categoryId)?.name ?? 'Sem categoria')
            : 'Sem categoria',
          color: categoryId ? (catName.get(categoryId)?.color ?? null) : null,
          total: val,
          share: val / total,
        }))
        .sort((a, b) => b.total - a.total);
    };

    // ---- cartões ----
    const limitTotal = cards.reduce((s, c) => s + nb(c.creditLimit), 0);
    const openInvoicesTotal = openInvoices.reduce((s, i) => s + nb(i.total), 0);
    const nextUnpaid = openInvoices.find((i) => dbDateToIso(i.dueDate) >= today) ?? openInvoices[0];

    // ---- saúde financeira ----
    const commitmentRatio = totalIncome > 0 ? committed / totalIncome : 0;
    const avgMonthlyExpense = nb(recentOutflow._sum.amount) / 3;
    const health = {
      savingsRate: totalIncome > 0 ? (totalIncome - totalExpense) / totalIncome : 0,
      commitmentRatio,
      runwayMonths: avgMonthlyExpense > 0 ? totalCurrent / avgMonthlyExpense : null,
    };

    return {
      month: anchor.slice(0, 7),
      totalIncome,
      totalExpense,
      net: totalIncome - totalExpense,
      prevMonth: {
        income: prevIncome,
        expense: prevExpense,
        incomePct: pct(totalIncome, prevIncome),
        expensePct: pct(totalExpense, prevExpense),
      },
      health,
      pendingIncome,
      pendingExpense,
      currentBalance: totalCurrent,
      projectedEndOfMonthBalance: running,
      upcomingBills,
      openInvoicesTotal,
      loanOutstanding,
      incomeCommitmentRatio: totalIncome > 0 ? committed / totalIncome : 0,
      categoryBreakdown: breakdown(byExpenseCat),
      incomeCategoryBreakdown: breakdown(byIncomeCat),
      credit: {
        limitTotal,
        openInvoicesTotal,
        available: Math.max(limitTotal - openInvoicesTotal, 0),
        usageRatio: limitTotal > 0 ? openInvoicesTotal / limitTotal : 0,
        nextDueDate: nextUnpaid ? dbDateToIso(nextUnpaid.dueDate) : null,
        nextDueAmount: nextUnpaid ? nb(nextUnpaid.total) : 0,
      },
      cashflow,
    };
  }

  /**
   * Patrimônio consolidado ao fim de cada um dos últimos N meses.
   * Transferências entre contas se cancelam no total, então só somamos
   * entradas/saídas liquidadas até o fim de cada mês + saldo de abertura.
   */
  async netWorth(userId: string, months: number) {
    const thisMonth = todaySP().slice(0, 7) + '-01';
    const [accounts, rows] = await Promise.all([
      this.db.account.findMany({ where: { userId }, select: { openingBalance: true } }),
      this.db.transaction.findMany({
        where: {
          userId,
          status: { not: 'CANCELED' },
          paidDate: { not: null },
          type: { in: [...IN, ...OUT] },
          accountId: { not: null },
        },
        // já vem ordenado pelo banco (índice [userId, paidDate]) — evita
        // reordenar em JS uma lista que só cresce com o histórico do usuário
        orderBy: { paidDate: 'asc' },
        select: { type: true, amount: true, paidDate: true },
      }),
    ]);

    const opening = accounts.reduce((s, a) => s + nb(a.openingBalance), 0);
    const deltas = rows.map((r) => ({
      date: dbDateToIso(r.paidDate as Date),
      v: IN.includes(r.type) ? nb(r.amount) : -nb(r.amount),
    }));

    const points: { month: string; total: number }[] = [];
    let i = 0;
    let running = opening;
    for (let k = months - 1; k >= 0; k--) {
      const monthEnd = endOfMonth(addMonths(thisMonth as IsoDate, -k));
      while (i < deltas.length && deltas[i]!.date <= monthEnd) {
        running += deltas[i]!.v;
        i++;
      }
      points.push({ month: monthEnd.slice(0, 7), total: running });
    }
    return { points };
  }
}
