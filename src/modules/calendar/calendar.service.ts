import type { PrismaClient, TransactionType } from '@prisma/client';
import { addDays, endOfMonth, type IsoDate, startOfMonth } from '@nodepay/shared';
import { nb } from '../../lib/money.js';
import { dbDateToIso, isoToDbDate } from '../../lib/date.js';

const INCOME: TransactionType[] = ['INCOME', 'LOAN_DISBURSEMENT'];
const EXPENSE: TransactionType[] = ['EXPENSE', 'CARD_EXPENSE', 'INVOICE_PAYMENT', 'LOAN_INSTALLMENT'];

export class CalendarService {
  constructor(private readonly db: PrismaClient) {}

  async month(scope: { userId?: string }, month: string) {
    const from = startOfMonth(`${month}-01`) as IsoDate;
    const to = endOfMonth(`${month}-01`) as IsoDate;

    // pega tudo cujo vencimento OU pagamento cai no mês
    const txns = await this.db.transaction.findMany({
      where: {
        ...(scope.userId ? { userId: scope.userId } : {}),
        status: { not: 'CANCELED' },
        type: { in: [...INCOME, ...EXPENSE] },
        OR: [
          { dueDate: { gte: isoToDbDate(from), lte: isoToDbDate(to) } },
          { paidDate: { gte: isoToDbDate(from), lte: isoToDbDate(to) } },
        ],
      },
      select: { type: true, amount: true, status: true, dueDate: true, paidDate: true },
    });

    const days = new Map<
      string,
      { incomePaid: number; incomePending: number; expensePaid: number; expensePending: number; count: number }
    >();
    for (let d: IsoDate = from; d <= to; d = addDays(d, 1)) {
      days.set(d, { incomePaid: 0, incomePending: 0, expensePaid: 0, expensePending: 0, count: 0 });
    }

    for (const t of txns) {
      const paid = t.status === 'PAID';
      // realizada -> dia do pagamento; prevista -> dia do vencimento
      const bucketDate = paid && t.paidDate ? dbDateToIso(t.paidDate) : dbDateToIso(t.dueDate);
      const cell = days.get(bucketDate);
      if (!cell) continue;
      const amt = nb(t.amount);
      const isIncome = INCOME.includes(t.type);
      if (isIncome) cell[paid ? 'incomePaid' : 'incomePending'] += amt;
      else cell[paid ? 'expensePaid' : 'expensePending'] += amt;
      cell.count += 1;
    }

    return {
      month,
      days: [...days.entries()].map(([date, v]) => ({ date, ...v })),
    };
  }
}
