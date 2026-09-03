import { type IsoDate, isoDateToJsDate } from '@nodepay/shared';

/**
 * Colunas @db.Date do Postgres voltam como Date em UTC meia-noite.
 * Lemos os componentes UTC diretamente para não deslocar o dia por causa do fuso.
 */
export function dbDateToIso(date: Date): IsoDate {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}` as IsoDate;
}

/** Grava um IsoDate como Date UTC meia-noite (coerente com dbDateToIso). */
export function isoToDbDate(date: IsoDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export { isoDateToJsDate };
