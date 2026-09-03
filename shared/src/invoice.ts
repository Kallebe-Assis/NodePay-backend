/**
 * "Regra de Ouro" do cartão de crédito.
 *
 * Dada a data da compra e o dia de fechamento do cartão, define em qual
 * fatura (mês de referência) a compra entra, e calcula o período e o
 * vencimento dessa fatura.
 *
 * Regra: se o dia da compra for <= dia de fechamento, cai na fatura que fecha
 * NESTE mês; senão, cai na fatura do mês seguinte.
 *
 * O período coberto por uma fatura vai do dia seguinte ao fechamento anterior
 * até o dia do fechamento atual (inclusive).
 */

import { DateTime } from 'luxon';
import { TIMEZONE } from './constants.js';
import { clampDayToMonth, type IsoDate, toDateTime } from './date.js';

export interface CreditCardCycle {
  /** 1..31 */
  closingDay: number;
  /** 1..31 */
  dueDay: number;
}

export interface InvoicePlacement {
  /** Mês de referência da fatura, 'YYYY-MM-01'. */
  referenceMonth: IsoDate;
  /** Primeiro dia coberto pela fatura. */
  periodStart: IsoDate;
  /** Último dia coberto (dia do fechamento). */
  periodEnd: IsoDate;
  /** Data de fechamento (== periodEnd). */
  closingDate: IsoDate;
  /** Data de vencimento da fatura. */
  dueDate: IsoDate;
}

function closingDateForMonth(year: number, month1to12: number, closingDay: number): IsoDate {
  return clampDayToMonth(year, month1to12, closingDay);
}

/** Em qual fatura a compra `purchaseDate` cai. */
export function placeInInvoice(purchaseDate: IsoDate, cycle: CreditCardCycle): InvoicePlacement {
  const d = toDateTime(purchaseDate);
  const thisMonthClosing = closingDateForMonth(d.year, d.month, cycle.closingDay);
  const closesThisMonth = d.toISODate()! <= thisMonthClosing;

  const ref = closesThisMonth ? d.startOf('month') : d.startOf('month').plus({ months: 1 });
  return buildPlacement(ref.year, ref.month, cycle);
}

/** Constrói o período/vencimento da fatura de um mês de referência. */
export function buildPlacement(
  refYear: number,
  refMonth1to12: number,
  cycle: CreditCardCycle,
): InvoicePlacement {
  const closingDate = closingDateForMonth(refYear, refMonth1to12, cycle.closingDay);
  const prev = DateTime.fromObject(
    { year: refYear, month: refMonth1to12, day: 1 },
    { zone: TIMEZONE },
  ).minus({ months: 1 });
  const prevClosing = closingDateForMonth(prev.year, prev.month, cycle.closingDay);
  const periodStart = toDateTime(prevClosing).plus({ days: 1 }).toISODate() as IsoDate;

  // Vencimento: normalmente alguns dias depois do fechamento. Se o dia de
  // vencimento for <= dia de fechamento, o vencimento é no mês seguinte.
  const dueInSameMonth = cycle.dueDay > cycle.closingDay;
  const dueAnchor = dueInSameMonth
    ? { year: refYear, month: refMonth1to12 }
    : DateTime.fromObject({ year: refYear, month: refMonth1to12, day: 1 })
        .plus({ months: 1 })
        .toObject();
  const dueDate = clampDayToMonth(dueAnchor.year!, dueAnchor.month!, cycle.dueDay);

  return {
    referenceMonth: clampDayToMonth(refYear, refMonth1to12, 1),
    periodStart,
    periodEnd: closingDate,
    closingDate,
    dueDate,
  };
}

/** Sequência de faturas para uma compra parcelada em N vezes. */
export function invoicesForInstallments(
  purchaseDate: IsoDate,
  installments: number,
  cycle: CreditCardCycle,
): InvoicePlacement[] {
  const first = placeInInvoice(purchaseDate, cycle);
  const ref = toDateTime(first.referenceMonth);
  return Array.from({ length: installments }, (_, i) => {
    const m = ref.plus({ months: i });
    return buildPlacement(m.year, m.month, cycle);
  });
}
