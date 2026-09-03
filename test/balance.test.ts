import { describe, expect, it } from 'vitest';
import { aggregate, type BalRow } from '../src/modules/accounts/balance.js';

const today = new Date('2026-09-03T00:00:00.000Z');
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const row = (p: Partial<BalRow>): BalRow => ({
  accountId: 'a1',
  transferToAccountId: null,
  type: 'EXPENSE',
  amount: 0n,
  status: 'PENDING',
  paidDate: null,
  ...p,
});

describe('aggregate (saldo por conta)', () => {
  it('parte do saldo de abertura quando não há lançamentos', () => {
    const r = aggregate([{ id: 'a1', openingBalance: 10_000n }], [], today);
    expect(r.get('a1')).toEqual({ currentBalance: 10_000, projectedBalance: 10_000 });
  });

  it('despesa liquidada até hoje entra no saldo atual e no projetado', () => {
    const r = aggregate(
      [{ id: 'a1', openingBalance: 10_000n }],
      [row({ type: 'EXPENSE', amount: 2_500n, status: 'PAID', paidDate: d('2026-09-01') })],
      today,
    );
    expect(r.get('a1')).toEqual({ currentBalance: 7_500, projectedBalance: 7_500 });
  });

  it('pagamento com data futura não conta no saldo atual, só no projetado', () => {
    const r = aggregate(
      [{ id: 'a1', openingBalance: 10_000n }],
      [row({ type: 'EXPENSE', amount: 2_500n, status: 'SCHEDULED', paidDate: null })],
      today,
    );
    expect(r.get('a1')).toEqual({ currentBalance: 10_000, projectedBalance: 7_500 });
  });

  it('receita soma; CANCELED/rascunho é ignorado', () => {
    const r = aggregate(
      [{ id: 'a1', openingBalance: 0n }],
      [
        row({ type: 'INCOME', amount: 5_000n, status: 'PAID', paidDate: d('2026-09-02') }),
        row({ type: 'EXPENSE', amount: 9_999n, status: 'CANCELED', paidDate: null }),
      ],
      today,
    );
    expect(r.get('a1')).toEqual({ currentBalance: 5_000, projectedBalance: 5_000 });
  });

  it('transferência sai da origem e entra no destino', () => {
    const r = aggregate(
      [
        { id: 'a1', openingBalance: 10_000n },
        { id: 'a2', openingBalance: 0n },
      ],
      [
        row({
          type: 'TRANSFER',
          amount: 3_000n,
          status: 'PAID',
          paidDate: d('2026-09-01'),
          accountId: 'a1',
          transferToAccountId: 'a2',
        }),
      ],
      today,
    );
    expect(r.get('a1')?.currentBalance).toBe(7_000);
    expect(r.get('a2')?.currentBalance).toBe(3_000);
  });
});
