import type { PrismaClient } from '@prisma/client';
import { addDays, endOfMonth, type IsoDate, startOfMonth, todaySP } from '@nodepay/shared';
import { nb } from '../../lib/money.js';
import { dbDateToIso, isoToDbDate } from '../../lib/date.js';
import { computeBalances } from '../accounts/balance.js';

const OUT = ['EXPENSE', 'INVOICE_PAYMENT', 'LOAN_INSTALLMENT'];
const IN = ['INCOME', 'LOAN_DISBURSEMENT'];
const PENDING = ['PENDING', 'SCHEDULED'];

export class DashboardService {
  constructor(private readonly db: PrismaClient) {}

  async summary(userId: string, month?: string) {
    const anchor: IsoDate = (month ? `${month}-01` : todaySP().slice(0, 7) + '-01') as IsoDate;
    const from = startOfMonth(anchor);
    const to = endOfMonth(anchor);
    const today = todaySP();
    const inMonth = { gte: isoToDbDate(from), lte: isoToDbDate(to) };

    const [txns, balances, categories, cards, openInvoices] = await Promise.all([
      this.db.transaction.findMany({
        where: { userId, status: { not: 'CANCELED' }, competenceDate: inMonth },
        select: {
          type: true,
          amount: true,
          status: true,
          dueDate: true,
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
    ]);

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

    // projeção diária do mês (usa tudo — inclusive pendentes — pelo vencimento)
    const dailyDelta = new Map<string, number>();
    for (const t of txns) {
      const d = dbDateToIso(t.dueDate);
      const amt = nb(t.amount);
      const signed = IN.includes(t.type) ? amt : OUT.includes(t.type) ? -amt : 0;
      dailyDelta.set(d, (dailyDelta.get(d) ?? 0) + signed);
    }
    const cashflow = [];
    let running = totalCurrent;
    for (let d: IsoDate = from; d <= to; d = addDays(d, 1)) {
      const delta = dailyDelta.get(d) ?? 0;
      running += delta;
      const dayTx = txns.filter((t) => dbDateToIso(t.dueDate) === d);
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

    return {
      month: anchor.slice(0, 7),
      totalIncome,
      totalExpense,
      net: totalIncome - totalExpense,
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
}
