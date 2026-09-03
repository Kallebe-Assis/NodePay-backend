import { describe, expect, it } from 'vitest';
import {
  buildSchedule,
  distribute,
  invoicesForInstallments,
  LoanSystem,
  placeInInvoice,
  reaisToCents,
  sumCents,
} from '@nodepay/shared';

describe('money', () => {
  it('interpreta valores em pt-BR', () => {
    expect(reaisToCents('1.234,56')).toBe(123456);
    expect(reaisToCents('R$ 120,50')).toBe(12050);
    expect(reaisToCents(120.5)).toBe(12050);
  });

  it('distribui sem perder centavos', () => {
    const parts = distribute(12050, 3);
    expect(parts).toEqual([4017, 4017, 4016]);
    expect(sumCents(parts)).toBe(12050);
  });
});

describe('regra de ouro do cartão', () => {
  const cycle = { closingDay: 20, dueDay: 27 };

  it('compra antes do fechamento entra na fatura do mês', () => {
    const p = placeInInvoice('2026-09-10', cycle);
    expect(p.referenceMonth).toBe('2026-09-01');
    expect(p.closingDate).toBe('2026-09-20');
    expect(p.dueDate).toBe('2026-09-27');
  });

  it('compra depois do fechamento entra na fatura seguinte', () => {
    const p = placeInInvoice('2026-09-21', cycle);
    expect(p.referenceMonth).toBe('2026-10-01');
  });

  it('parcela em faturas consecutivas', () => {
    const invs = invoicesForInstallments('2026-09-21', 3, cycle);
    expect(invs.map((i) => i.referenceMonth)).toEqual(['2026-10-01', '2026-11-01', '2026-12-01']);
  });
});

describe('amortização', () => {
  it('Price: soma das parcelas quita o principal + juros', () => {
    const s = buildSchedule({
      principal: 1_000_000,
      monthlyRate: 0.02,
      installments: 12,
      firstDueDate: '2026-10-05',
      system: LoanSystem.PRICE,
    });
    expect(s.rows).toHaveLength(12);
    expect(s.rows.at(-1)!.balanceAfter).toBe(0);
    expect(sumCents(s.rows.map((r) => r.principal))).toBe(1_000_000);
  });

  it('SAC: amortização constante e saldo zera', () => {
    const s = buildSchedule({
      principal: 1_200_000,
      monthlyRate: 0.015,
      installments: 12,
      firstDueDate: '2026-10-05',
      system: LoanSystem.SAC,
    });
    expect(s.rows[0]!.principal).toBe(100_000);
    expect(s.rows.at(-1)!.balanceAfter).toBe(0);
  });
});
