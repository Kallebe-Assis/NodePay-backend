import type { PrismaClient, TransactionType } from '@prisma/client';
import { addDays, todaySP, type IsoDate } from '@nodepay/shared';
import { nb } from '../../lib/money.js';
import { isoToDbDate } from '../../lib/date.js';

const IN: TransactionType[] = ['INCOME', 'LOAN_DISBURSEMENT'];
const OUT: TransactionType[] = ['EXPENSE', 'CARD_EXPENSE', 'INVOICE_PAYMENT', 'LOAN_INSTALLMENT'];

export interface WeeklySummary {
  from: IsoDate;
  to: IsoDate;
  income: number;
  expense: number;
  net: number;
  topCategory: { name: string; total: number } | null;
}

/** Totais dos últimos 7 dias (liquidados), com a categoria de maior gasto. */
export async function computeWeeklySummary(db: PrismaClient, userId: string): Promise<WeeklySummary> {
  const to = todaySP();
  const from = addDays(to, -6);

  const rows = await db.transaction.findMany({
    where: {
      userId,
      status: 'PAID',
      paidDate: { gte: isoToDbDate(from), lte: isoToDbDate(to) },
      type: { in: [...IN, ...OUT] },
    },
    select: { type: true, amount: true, categoryId: true, category: { select: { name: true } } },
  });

  let income = 0;
  let expense = 0;
  const byCat = new Map<string, number>();
  for (const r of rows) {
    const amt = nb(r.amount);
    if (IN.includes(r.type)) income += amt;
    else {
      expense += amt;
      const name = r.category?.name ?? 'Sem categoria';
      byCat.set(name, (byCat.get(name) ?? 0) + amt);
    }
  }

  let topCategory: WeeklySummary['topCategory'] = null;
  for (const [name, total] of byCat) {
    if (!topCategory || total > topCategory.total) topCategory = { name, total };
  }

  return { from, to, income, expense, net: income - expense, topCategory };
}
