import type { PrismaClient } from '@prisma/client';
import {
  addDays,
  type ChartsResponse,
  type IsoDate,
} from '@nodepay/shared';
import { nb } from '../../lib/money.js';
import { dbDateToIso, isoToDbDate } from '../../lib/date.js';

const IN = ['INCOME', 'LOAN_DISBURSEMENT'];
const OUT_CASH = ['EXPENSE', 'INVOICE_PAYMENT', 'LOAN_INSTALLMENT'];
const OUT_SPEND = ['EXPENSE', 'CARD_EXPENSE']; // visão de "onde gastei"

export class ChartsService {
  constructor(private readonly db: PrismaClient) {}

  async build(
    scope: { userId?: string },
    from: IsoDate,
    to: IsoDate,
  ): Promise<ChartsResponse> {
    const userWhere = scope.userId ? { userId: scope.userId } : {};

    const txns = await this.db.transaction.findMany({
      where: {
        ...userWhere,
        status: { not: 'CANCELED' },
        competenceDate: { gte: isoToDbDate(from), lte: isoToDbDate(to) },
      },
      select: {
        type: true,
        amount: true,
        status: true,
        description: true,
        competenceDate: true,
        dueDate: true,
        paidDate: true,
        categoryId: true,
        recurrenceId: true,
      },
    });

    const categories = await this.db.category.findMany({
      where: userWhere,
      select: { id: true, name: true, color: true },
    });
    const catMap = new Map(categories.map((c) => [c.id, c]));

    let income = 0;
    let expense = 0;
    const byMonth = new Map<string, { income: number; expense: number }>();
    const expByCat = new Map<string | null, number>();
    const incByCat = new Map<string | null, number>();
    const byDescr = new Map<string, number>();
    let paid = 0;
    let pending = 0;
    let fixed = 0;
    let variable = 0;

    for (const t of txns) {
      const amt = nb(t.amount);
      const month = dbDateToIso(t.competenceDate).slice(0, 7);
      const slot = byMonth.get(month) ?? { income: 0, expense: 0 };

      if (IN.includes(t.type)) {
        income += amt;
        slot.income += amt;
        if (t.type === 'INCOME') incByCat.set(t.categoryId, (incByCat.get(t.categoryId) ?? 0) + amt);
      }
      if (OUT_CASH.includes(t.type)) {
        expense += amt;
        slot.expense += amt;
        if (t.status === 'PAID') paid += amt;
        else pending += amt;
        if (t.recurrenceId) fixed += amt;
        else variable += amt;
      }
      if (OUT_SPEND.includes(t.type)) {
        expByCat.set(t.categoryId, (expByCat.get(t.categoryId) ?? 0) + amt);
        byDescr.set(t.description, (byDescr.get(t.description) ?? 0) + amt);
      }
      byMonth.set(month, slot);
    }

    const catRows = (m: Map<string | null, number>) =>
      [...m.entries()]
        .map(([categoryId, total]) => ({
          categoryId,
          name: categoryId ? (catMap.get(categoryId)?.name ?? 'Sem categoria') : 'Sem categoria',
          color: categoryId ? (catMap.get(categoryId)?.color ?? null) : null,
          total,
        }))
        .sort((a, b) => b.total - a.total);

    return {
      from,
      to,
      totals: { income, expense, net: income - expense },
      incomeExpenseByMonth: [...byMonth.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, v]) => ({ month, income: v.income, expense: v.expense, net: v.income - v.expense })),
      expenseByCategory: catRows(expByCat),
      incomeByCategory: catRows(incByCat),
      balanceEvolution: await this.balanceEvolution(scope, from, to),
      topExpenses: [...byDescr.entries()]
        .sort(([, a], [, b]) => b - a)
        .slice(0, 8)
        .map(([description, total]) => ({ description, total })),
      statusSplit: { paid, pending },
      fixedVsVariable: { fixed, variable },
    };
  }

  /** saldo (contas do dashboard) acumulado ao longo do período — amostrado se muito longo */
  private async balanceEvolution(scope: { userId?: string }, from: IsoDate, to: IsoDate) {
    const userWhere = scope.userId ? { userId: scope.userId } : {};
    const accounts = await this.db.account.findMany({
      where: { ...userWhere, includeInDashboard: true },
      select: { id: true, openingBalance: true },
    });
    if (accounts.length === 0) return [];
    const ids = accounts.map((a) => a.id);
    const opening = accounts.reduce((s, a) => s + nb(a.openingBalance), 0);

    const toDb = isoToDbDate(to);
    const movements = await this.db.transaction.findMany({
      where: {
        ...userWhere,
        status: { not: 'CANCELED' },
        AND: [
          { OR: [{ accountId: { in: ids } }, { transferToAccountId: { in: ids } }] },
          { OR: [{ paidDate: { lte: toDb } }, { paidDate: null, dueDate: { lte: toDb } }] },
        ],
      },
      select: {
        type: true,
        amount: true,
        accountId: true,
        transferToAccountId: true,
        dueDate: true,
        paidDate: true,
      },
    });

    // delta assinado por dia (bucket: pagamento se houver, senão vencimento)
    const daily = new Map<string, number>();
    let startBalance = opening;
    for (const m of movements) {
      const d = m.paidDate ? dbDateToIso(m.paidDate) : dbDateToIso(m.dueDate);
      const amt = nb(m.amount);
      let signed = 0;
      if (IN.includes(m.type) && ids.includes(m.accountId ?? '')) signed = amt;
      else if (OUT_CASH.includes(m.type) && ids.includes(m.accountId ?? '')) signed = -amt;
      else if (m.type === 'TRANSFER') {
        if (ids.includes(m.accountId ?? '')) signed -= amt;
        if (ids.includes(m.transferToAccountId ?? '')) signed += amt;
      }
      if (d < from) startBalance += signed;
      else daily.set(d, (daily.get(d) ?? 0) + signed);
    }

    const totalDays = Math.round((isoToDbDate(to).getTime() - isoToDbDate(from).getTime()) / 86_400_000);
    const step = totalDays > 120 ? 7 : 1;
    const out: { date: IsoDate; balance: number }[] = [];
    let running = startBalance;
    let d: IsoDate = from;
    let i = 0;
    while (d <= to) {
      running += daily.get(d) ?? 0;
      if (i % step === 0 || d === to) out.push({ date: d, balance: running });
      d = addDays(d, 1);
      i++;
    }
    return out;
  }
}
