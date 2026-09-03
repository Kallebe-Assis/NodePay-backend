import type { PrismaClient } from '@prisma/client';
import { todaySP, isoDateToJsDate } from '@nodepay/shared';
import { nb } from '../../lib/money.js';

export interface AccountBalances {
  currentBalance: number;
  projectedBalance: number;
}

type BalRow = {
  accountId: string | null;
  transferToAccountId: string | null;
  type: string;
  amount: bigint;
  status: string;
  paidDate: Date | null;
};

const OUT = new Set(['EXPENSE', 'INVOICE_PAYMENT', 'LOAN_INSTALLMENT']);
const IN = new Set(['INCOME', 'LOAN_DISBURSEMENT']);
const PENDING = new Set(['PENDING', 'SCHEDULED']);

const TX_SELECT = {
  accountId: true,
  transferToAccountId: true,
  type: true,
  amount: true,
  status: true,
  paidDate: true,
} as const;

/**
 * Saldo **atual** (só lançamentos liquidados até hoje) e **projetado**
 * (+ pendentes/agendados) de uma ou de todas as contas de um usuário.
 *
 * Sinal:
 *  - entra:  INCOME, LOAN_DISBURSEMENT, TRANSFER que cai em `transferToAccountId`
 *  - sai:    EXPENSE, INVOICE_PAYMENT, LOAN_INSTALLMENT, TRANSFER que sai de `accountId`
 *
 * Custo: **1 ida ao banco** no caso comum (escopo de 1 usuário — contas e
 * lançamentos são buscados em paralelo). Antes eram 9 idas (1 + 8 `groupBy`),
 * o que pesava demais com o banco fora da máquina.
 */
export async function computeBalances(
  db: PrismaClient,
  scope: { userId?: string },
  opts: { accountId?: string; dashboardOnly?: boolean } = {},
): Promise<Map<string, AccountBalances>> {
  const today = isoDateToJsDate(todaySP());

  const accountWhere = {
    ...(opts.accountId ? { id: opts.accountId } : {}),
    ...(opts.dashboardOnly ? { includeInDashboard: true } : {}),
  };

  // --- caso comum: 1 usuário -> contas + lançamentos em paralelo (1 wave) ---
  if (scope.userId) {
    const [accounts, rows] = await Promise.all([
      db.account.findMany({
        where: { userId: scope.userId, ...accountWhere },
        select: { id: true, openingBalance: true },
      }),
      db.transaction.findMany({
        where: { userId: scope.userId, status: { not: 'CANCELED' } },
        select: TX_SELECT,
      }),
    ]);
    return aggregate(accounts, rows as BalRow[], today);
  }

  // --- admin "todos os usuários": precisa dos ids primeiro (2 waves) ---
  const accounts = await db.account.findMany({
    where: accountWhere,
    select: { id: true, openingBalance: true },
  });
  if (accounts.length === 0) return new Map();
  const accountIds = accounts.map((a) => a.id);
  const rows = await db.transaction.findMany({
    where: {
      status: { not: 'CANCELED' },
      OR: [{ accountId: { in: accountIds } }, { transferToAccountId: { in: accountIds } }],
    },
    select: TX_SELECT,
  });
  return aggregate(accounts, rows as BalRow[], today);
}

/** Soma os lançamentos por conta (em memória) e devolve saldo atual + projetado. */
function aggregate(
  accounts: { id: string; openingBalance: bigint }[],
  rows: BalRow[],
  today: Date,
): Map<string, AccountBalances> {
  const result = new Map<string, AccountBalances>();
  if (accounts.length === 0) return result;

  const ids = new Set(accounts.map((a) => a.id));
  const curDelta = new Map<string, number>();
  const pendDelta = new Map<string, number>();
  const add = (m: Map<string, number>, id: string, v: number) => m.set(id, (m.get(id) ?? 0) + v);

  for (const r of rows) {
    const amt = nb(r.amount);
    const liquidado = r.paidDate != null && r.paidDate <= today;
    const pendente = PENDING.has(r.status);
    if (!liquidado && !pendente) continue;

    // ponta de origem (accountId)
    if (r.accountId && ids.has(r.accountId)) {
      const sign = IN.has(r.type) ? 1 : OUT.has(r.type) || r.type === 'TRANSFER' ? -1 : 0;
      if (sign !== 0) {
        if (liquidado) add(curDelta, r.accountId, sign * amt);
        if (pendente) add(pendDelta, r.accountId, sign * amt);
      }
    }

    // ponta de destino da transferência (transferToAccountId)
    if (r.type === 'TRANSFER' && r.transferToAccountId && ids.has(r.transferToAccountId)) {
      if (liquidado) add(curDelta, r.transferToAccountId, amt);
      if (pendente) add(pendDelta, r.transferToAccountId, amt);
    }
  }

  for (const acc of accounts) {
    const current = nb(acc.openingBalance) + (curDelta.get(acc.id) ?? 0);
    result.set(acc.id, { currentBalance: current, projectedBalance: current + (pendDelta.get(acc.id) ?? 0) });
  }
  return result;
}
