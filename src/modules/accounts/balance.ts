import type { PrismaClient } from '@prisma/client';
import { todaySP, isoDateToJsDate } from '@nodepay/shared';
import { nb } from '../../lib/money.js';

export interface AccountBalances {
  currentBalance: number;
  projectedBalance: number;
}

/**
 * Calcula saldo atual (só liquidados até hoje) e projetado (+ pendentes/agendados)
 * para uma ou todas as contas de um usuário.
 *
 * Regras de sinal:
 *  - entra:  INCOME, LOAN_DISBURSEMENT, TRANSFER quando cai em transferToAccountId
 *  - sai:    EXPENSE, INVOICE_PAYMENT, LOAN_INSTALLMENT, TRANSFER quando sai de accountId
 */
export async function computeBalances(
  db: PrismaClient,
  scope: { userId?: string },
  opts: { accountId?: string; dashboardOnly?: boolean } = {},
): Promise<Map<string, AccountBalances>> {
  const today = isoDateToJsDate(todaySP());
  const userFilter = scope.userId ? { userId: scope.userId } : {};
  const accounts = await db.account.findMany({
    where: {
      ...userFilter,
      ...(opts.accountId ? { id: opts.accountId } : {}),
      ...(opts.dashboardOnly ? { includeInDashboard: true } : {}),
    },
    select: { id: true, openingBalance: true },
  });

  const result = new Map<string, AccountBalances>();
  if (accounts.length === 0) return result;

  const accountIds = accounts.map((a) => a.id);
  const OUT = ['EXPENSE', 'INVOICE_PAYMENT', 'LOAN_INSTALLMENT'] as const;
  const IN = ['INCOME', 'LOAN_DISBURSEMENT'] as const;

  // helper para somar por conta
  async function sumBy(
    field: 'accountId' | 'transferToAccountId',
    where: Record<string, unknown>,
  ) {
    const rows = await db.transaction.groupBy({
      by: [field],
      where: { [field]: { in: accountIds }, status: { not: 'CANCELED' }, ...where },
      _sum: { amount: true },
    });
    const map = new Map<string, number>();
    for (const r of rows) {
      const key = (r as any)[field] as string | null;
      if (key) map.set(key, nb(r._sum.amount));
    }
    return map;
  }

  const paidFilter = { paidDate: { not: null, lte: today } };
  const pendingFilter = { status: { in: ['PENDING', 'SCHEDULED'] as const } };

  const [
    paidOut,
    paidIn,
    paidTransferOut,
    paidTransferIn,
    pendOut,
    pendIn,
    pendTransferOut,
    pendTransferIn,
  ] = await Promise.all([
    sumBy('accountId', { type: { in: OUT as unknown as string[] }, ...paidFilter }),
    sumBy('accountId', { type: { in: IN as unknown as string[] }, ...paidFilter }),
    sumBy('accountId', { type: 'TRANSFER', ...paidFilter }),
    sumBy('transferToAccountId', { type: 'TRANSFER', ...paidFilter }),
    sumBy('accountId', { type: { in: OUT as unknown as string[] }, ...pendingFilter }),
    sumBy('accountId', { type: { in: IN as unknown as string[] }, ...pendingFilter }),
    sumBy('accountId', { type: 'TRANSFER', ...pendingFilter }),
    sumBy('transferToAccountId', { type: 'TRANSFER', ...pendingFilter }),
  ]);

  for (const acc of accounts) {
    const opening = nb(acc.openingBalance);
    const current =
      opening +
      (paidIn.get(acc.id) ?? 0) +
      (paidTransferIn.get(acc.id) ?? 0) -
      (paidOut.get(acc.id) ?? 0) -
      (paidTransferOut.get(acc.id) ?? 0);

    const projected =
      current +
      (pendIn.get(acc.id) ?? 0) +
      (pendTransferIn.get(acc.id) ?? 0) -
      (pendOut.get(acc.id) ?? 0) -
      (pendTransferOut.get(acc.id) ?? 0);

    result.set(acc.id, { currentBalance: current, projectedBalance: projected });
  }
  return result;
}
