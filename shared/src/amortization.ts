/**
 * Tabelas de amortização de empréstimo: Price (parcela fixa) e SAC
 * (amortização fixa, parcela decrescente). Tudo em centavos inteiros;
 * o resíduo de arredondamento é jogado na última parcela.
 */

import { type Cents, sumCents } from './money.js';
import { addMonths, clampDayToMonth, type IsoDate, toDateTime } from './date.js';
import { LoanSystem } from './constants.js';

export interface AmortizationInput {
  principal: Cents;
  /** Taxa de juros ao mês, em fração. Ex.: 0.0199 para 1,99% a.m. */
  monthlyRate: number;
  installments: number;
  firstDueDate: IsoDate;
  system: LoanSystem;
}

export interface AmortizationRow {
  number: number;
  dueDate: IsoDate;
  interest: Cents;
  principal: Cents;
  payment: Cents;
  balanceAfter: Cents;
}

export interface AmortizationSchedule {
  rows: AmortizationRow[];
  totalInterest: Cents;
  totalPaid: Cents;
}

function dueDateFor(firstDueDate: IsoDate, index: number): IsoDate {
  const first = toDateTime(firstDueDate);
  const target = addMonths(firstDueDate, index);
  // preserva o "dia" da primeira parcela mesmo em meses curtos
  const t = toDateTime(target);
  return clampDayToMonth(t.year, t.month, first.day);
}

export function buildSchedule(input: AmortizationInput): AmortizationSchedule {
  const { principal, monthlyRate, installments, firstDueDate, system } = input;
  if (installments <= 0) throw new Error('Número de parcelas inválido');
  if (principal <= 0) throw new Error('Principal inválido');

  const rows: AmortizationRow[] = [];
  let balance = principal;

  if (system === LoanSystem.PRICE) {
    const i = monthlyRate;
    const rawPayment =
      i === 0 ? principal / installments : (principal * i) / (1 - Math.pow(1 + i, -installments));
    const payment = Math.round(rawPayment);

    for (let n = 1; n <= installments; n++) {
      const interest = Math.round(balance * i);
      let amort = payment - interest;
      let thisPayment = payment;
      if (n === installments) {
        // última parcela quita o saldo exato
        amort = balance;
        thisPayment = balance + interest;
      }
      balance -= amort;
      rows.push({
        number: n,
        dueDate: dueDateFor(firstDueDate, n - 1),
        interest,
        principal: amort,
        payment: thisPayment,
        balanceAfter: Math.max(balance, 0),
      });
    }
  } else {
    // SAC
    const baseAmort = Math.floor(principal / installments);
    let distributed = 0;
    for (let n = 1; n <= installments; n++) {
      const interest = Math.round(balance * monthlyRate);
      let amort = baseAmort;
      if (n === installments) amort = principal - distributed; // resíduo na última
      distributed += amort;
      balance -= amort;
      rows.push({
        number: n,
        dueDate: dueDateFor(firstDueDate, n - 1),
        interest,
        principal: amort,
        payment: amort + interest,
        balanceAfter: Math.max(balance, 0),
      });
    }
  }

  const totalInterest = sumCents(rows.map((r) => r.interest));
  const totalPaid = sumCents(rows.map((r) => r.payment));
  return { rows, totalInterest, totalPaid };
}
