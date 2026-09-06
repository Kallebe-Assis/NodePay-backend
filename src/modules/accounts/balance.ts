import type { PrismaClient } from '@prisma/client';
import { todaySP, isoDateToJsDate } from '@nodepay/shared';
import { nb } from '../../lib/money.js';

export interface AccountBalances {
  currentBalance: number;
  projectedBalance: number;
}

export type BalRow = {
  accountId: string | null;
  transferToAccountId: string | null;
  type: string;
  amount: bigint;
  paidAmount?: bigint | null;
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
  paidAmount: true,
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
        // só lançamentos que tocam alguma conta (exclui compras de cartão ainda
        // não pagas, que não afetam saldo) — poupa varrer linhas irrelevantes.
        where: {
          userId: scope.userId,
          status: { not: 'CANCELED' },
          OR: [{ accountId: { not: null } }, { transferToAccountId: { not: null } }],
        },
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
export function aggregate(
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
    const full = nb(r.amount);
    const isPartial = r.status === 'PARTIAL';
    // quanto já foi liquidado: total (PAID), parcial (PARTIAL) ou nada.
    const paidPortion = isPartial ? nb(r.paidAmount ?? 0n) : r.status === 'PAID' ? full : 0;
    const liquidadoDate = r.paidDate != null && r.paidDate <= today;
    const realizedNow = liquidadoDate ? paidPortion : 0;
    // o que ainda falta liquidar entra no projetado (pendente/agendado/parcial).
    const pendingPortion = PENDING.has(r.status) || isPartial ? full - paidPortion : 0;
    if (realizedNow === 0 && pendingPortion === 0) continue;

    // ponta de origem (accountId)
    if (r.accountId && ids.has(r.accountId)) {
      const sign = IN.has(r.type) ? 1 : OUT.has(r.type) || r.type === 'TRANSFER' ? -1 : 0;
      if (sign !== 0) {
        if (realizedNow) add(curDelta, r.accountId, sign * realizedNow);
        if (pendingPortion) add(pendDelta, r.accountId, sign * pendingPortion);
      }
    }

    // ponta de destino da transferência (transferToAccountId)
    if (r.type === 'TRANSFER' && r.transferToAccountId && ids.has(r.transferToAccountId)) {
      if (realizedNow) add(curDelta, r.transferToAccountId, realizedNow);
      if (pendingPortion) add(pendDelta, r.transferToAccountId, pendingPortion);
    }
  }

  for (const acc of accounts) {
    const current = nb(acc.openingBalance) + (curDelta.get(acc.id) ?? 0);
    result.set(acc.id, { currentBalance: current, projectedBalance: current + (pendDelta.get(acc.id) ?? 0) });
  }
  return result;
}
