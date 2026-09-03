import type { PrismaClient } from '@prisma/client';
import {
  addMonths,
  endOfMonth,
  type GoalProgress,
  type IsoDate,
  startOfMonth,
  todaySP,
} from '@nodepay/shared';
import type { TransactionType } from '@prisma/client';
import { nb } from '../../lib/money.js';
import { isoToDbDate } from '../../lib/date.js';

const EXPENSE_TYPES: TransactionType[] = ['EXPENSE', 'CARD_EXPENSE'];
const INFLOW: TransactionType[] = ['INCOME', 'LOAN_DISBURSEMENT'];
const OUTFLOW: TransactionType[] = ['EXPENSE', 'INVOICE_PAYMENT', 'LOAN_INSTALLMENT'];

interface GoalLike {
  type: 'SPEND_MAX' | 'EARN_MIN' | 'NET_MIN' | 'END_BALANCE_MIN';
  targetAmount: bigint;
  recurrence: 'ONCE' | 'MONTHLY' | 'N_MONTHS';
  monthsCount: number | null;
  startMonth: Date; // @db.Date
  categoryId: string | null;
}

/** 'YYYY-MM' de um Date @db.Date (componentes UTC). */
function ym(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function lastPeriodOf(goal: GoalLike): string | null {
  const totalMonths =
    goal.recurrence === 'ONCE' ? 1 : goal.recurrence === 'N_MONTHS' ? (goal.monthsCount ?? 1) : Infinity;
  if (totalMonths === Infinity) return null;
  return addMonths(`${ym(goal.startMonth)}-01`, totalMonths - 1).slice(0, 7);
}

/** Período (mês) que deve ser avaliado agora para um objetivo. */
export function resolvePeriod(goal: GoalLike): { period: string; isCurrent: boolean } | null {
  const start = ym(goal.startMonth);
  const currentYm = todaySP().slice(0, 7);
  const lastYm = lastPeriodOf(goal);

  if (currentYm < start) return null; // ainda não começou
  if (lastYm && currentYm > lastYm) {
    return { period: lastYm, isCurrent: false }; // já terminou -> último período
  }
  return { period: currentYm, isCurrent: true };
}

/**
 * Último período JÁ ENCERRADO de um objetivo — o que deve ser conferido
 * "no dia 01 do mês seguinte". Ex.: objetivo de setembro só é conferido em outubro.
 * Retorna 'YYYY-MM' ou null (ainda não há mês fechado dentro da vigência).
 */
export function lastCompletedPeriod(goal: GoalLike): string | null {
  const start = ym(goal.startMonth);
  const prevMonth = addMonths(`${todaySP().slice(0, 7)}-01`, -1).slice(0, 7);
  if (prevMonth < start) return null; // o 1º mês do objetivo ainda não fechou
  const lastYm = lastPeriodOf(goal);
  return lastYm && prevMonth > lastYm ? lastYm : prevMonth;
}

export async function evaluateGoal(
  db: PrismaClient,
  userId: string,
  goal: GoalLike,
  /** força a avaliação de um mês específico 'YYYY-MM' (senão usa o período corrente) */
  explicitPeriod?: string,
): Promise<GoalProgress | null> {
  const resolved = explicitPeriod
    ? { period: explicitPeriod, isCurrent: explicitPeriod >= todaySP().slice(0, 7) }
    : resolvePeriod(goal);
  if (!resolved) return null;

  const periodStart = startOfMonth(`${resolved.period}-01`) as IsoDate;
  const periodEnd = endOfMonth(`${resolved.period}-01`) as IsoDate;
  const inMonth = { gte: isoToDbDate(periodStart), lte: isoToDbDate(periodEnd) };
  const target = nb(goal.targetAmount);

  let current = 0;

  if (goal.type === 'SPEND_MAX') {
    const agg = await db.transaction.aggregate({
      where: {
        userId,
        type: { in: EXPENSE_TYPES },
        status: { not: 'CANCELED' },
        competenceDate: inMonth,
        ...(goal.categoryId ? { categoryId: goal.categoryId } : {}),
      },
      _sum: { amount: true },
    });
    current = nb(agg._sum?.amount);
  } else if (goal.type === 'EARN_MIN') {
    const agg = await db.transaction.aggregate({
      where: {
        userId,
        type: 'INCOME',
        status: { not: 'CANCELED' },
        competenceDate: inMonth,
        ...(goal.categoryId ? { categoryId: goal.categoryId } : {}),
      },
      _sum: { amount: true },
    });
    current = nb(agg._sum?.amount);
  } else if (goal.type === 'NET_MIN') {
    const rows = await db.transaction.groupBy({
      by: ['type'],
      where: { userId, status: { not: 'CANCELED' }, competenceDate: inMonth },
      _sum: { amount: true },
    });
    let income = 0;
    let expense = 0;
    for (const r of rows) {
      if (INFLOW.includes(r.type)) income += nb(r._sum.amount);
      if (OUTFLOW.includes(r.type)) expense += nb(r._sum.amount);
    }
    current = income - expense;
  } else {
    // END_BALANCE_MIN: saldo das contas do dashboard projetado até periodEnd
    current = await projectedBalanceAsOf(db, userId, periodEnd);
  }

  const isCap = goal.type === 'SPEND_MAX';
  const achieved = isCap ? current <= target : current >= target;
  const ratio = target === 0 ? (achieved ? 1 : 0) : current / target;
  // "onTrack": para teto, ainda dentro; para piso, já bateu OU período encerrado com sucesso
  const onTrack = isCap ? current <= target : achieved;

  return {
    period: resolved.period,
    periodStart,
    periodEnd,
    isCurrent: resolved.isCurrent,
    current,
    target,
    ratio: Math.round(ratio * 1000) / 1000,
    achieved,
    onTrack,
  };
}

async function projectedBalanceAsOf(
  db: PrismaClient,
  userId: string,
  date: IsoDate,
): Promise<number> {
  const accounts = await db.account.findMany({
    where: { userId, includeInDashboard: true },
    select: { id: true, openingBalance: true },
  });
  if (accounts.length === 0) return 0;
  const ids = accounts.map((a) => a.id);
  const opening = accounts.reduce((s, a) => s + nb(a.openingBalance), 0);
  const upto = isoToDbDate(date);

  async function sum(field: 'accountId' | 'transferToAccountId', where: Record<string, unknown>) {
    const rows = await db.transaction.groupBy({
      by: [field],
      where: { userId, [field]: { in: ids }, status: { not: 'CANCELED' }, ...where },
      _sum: { amount: true },
    });
    return rows.reduce((s, r) => s + nb(r._sum.amount), 0);
  }

  // liquidados até a data + pendentes/agendados com vencimento até a data
  const dateCond = {
    OR: [{ paidDate: { not: null, lte: upto } }, { paidDate: null, dueDate: { lte: upto } }],
  };
  const [out, inn, tOut, tIn] = await Promise.all([
    sum('accountId', { type: { in: OUTFLOW }, ...dateCond }),
    sum('accountId', { type: { in: INFLOW }, ...dateCond }),
    sum('accountId', { type: 'TRANSFER', ...dateCond }),
    sum('transferToAccountId', { type: 'TRANSFER', ...dateCond }),
  ]);
  return opening + inn + tIn - out - tOut;
}
