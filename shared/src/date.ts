/**
 * Utilidades de data. Todo o sistema opera no fuso America/Sao_Paulo.
 *
 * Convenção: datas "de calendário" (competência, vencimento, pagamento) são
 * strings ISO `YYYY-MM-DD` (sem hora, sem fuso). Instantes (createdAt) são ISO
 * completos em UTC. Isso evita a classe inteira de bugs de virada de dia/mês.
 */

import { DateTime } from 'luxon';
import { TIMEZONE } from './constants.js';

/** String de data de calendário: 'YYYY-MM-DD'. */
export type IsoDate = string;

export function nowSP(): DateTime {
  return DateTime.now().setZone(TIMEZONE);
}

/** Data de hoje no fuso de SP, como 'YYYY-MM-DD'. */
export function todaySP(): IsoDate {
  return nowSP().toISODate() as IsoDate;
}

export function toDateTime(date: IsoDate): DateTime {
  const dt = DateTime.fromISO(date, { zone: TIMEZONE });
  if (!dt.isValid) throw new Error(`Data inválida: "${date}" (${dt.invalidReason})`);
  return dt;
}

export function isValidIsoDate(value: string): value is IsoDate {
  return DateTime.fromISO(value, { zone: TIMEZONE }).isValid && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Converte um IsoDate para Date (meia-noite no fuso de SP), para gravar no Postgres. */
export function isoDateToJsDate(date: IsoDate): Date {
  return toDateTime(date).startOf('day').toJSDate();
}

/** Converte um Date do banco de volta para IsoDate no fuso de SP. */
export function jsDateToIsoDate(date: Date): IsoDate {
  return DateTime.fromJSDate(date).setZone(TIMEZONE).toISODate() as IsoDate;
}

export function addMonths(date: IsoDate, months: number): IsoDate {
  return toDateTime(date).plus({ months }).toISODate() as IsoDate;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return toDateTime(date).plus({ days }).toISODate() as IsoDate;
}

export function startOfMonth(date: IsoDate): IsoDate {
  return toDateTime(date).startOf('month').toISODate() as IsoDate;
}

export function endOfMonth(date: IsoDate): IsoDate {
  return toDateTime(date).endOf('month').toISODate() as IsoDate;
}

/**
 * Ajusta um "dia do mês" para um mês específico, respeitando meses curtos.
 * Ex.: dia 31 em fevereiro => 28 (ou 29 em ano bissexto).
 */
export function clampDayToMonth(year: number, month1to12: number, day: number): IsoDate {
  const anchor = DateTime.fromObject({ year, month: month1to12, day: 1 }, { zone: TIMEZONE });
  const safeDay = Math.min(day, anchor.daysInMonth ?? 28);
  return anchor.set({ day: safeDay }).toISODate() as IsoDate;
}

const longDateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: TIMEZONE,
});

/** 'YYYY-MM-DD' => '15 de out. de 2023' */
export function formatLongDate(date: IsoDate): string {
  return longDateFormatter.format(isoDateToJsDate(date));
}

/** 'YYYY-MM-DD' => '15/10/2023' */
export function formatShortDate(date: IsoDate): string {
  return toDateTime(date).toFormat('dd/MM/yyyy');
}
