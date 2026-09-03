/**
 * Utilidades de dinheiro.
 *
 * REGRA DE OURO: dinheiro é sempre INTEIRO em centavos.
 * Nunca use float para armazenar ou somar valores monetários.
 * A conversão para "reais" acontece só na borda (input do usuário / formatação).
 */

import { CURRENCY, LOCALE } from './constants.js';

/** Centavos: inteiro. Ex.: R$ 120,50 => 12050 */
export type Cents = number;

const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;

export function assertCents(value: number): asserts value is Cents {
  if (!Number.isInteger(value)) {
    throw new Error(`Valor monetário deve ser inteiro em centavos, recebido: ${value}`);
  }
  if (Math.abs(value) > MAX_SAFE_CENTS) {
    throw new Error(`Valor monetário fora do intervalo seguro: ${value}`);
  }
}

/** Converte reais (número ou string "1.234,56" / "1234.56") para centavos. */
export function reaisToCents(input: number | string): Cents {
  if (typeof input === 'number') {
    return Math.round(input * 100);
  }
  const normalized = input
    .trim()
    .replace(/\s|R\$/gi, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '') // remove separador de milhar
    .replace(',', '.');
  const parsed = Number(normalized);
  if (Number.isNaN(parsed)) {
    throw new Error(`Não foi possível interpretar o valor: "${input}"`);
  }
  return Math.round(parsed * 100);
}

/** Converte centavos para número em reais (use só para exibir / exportar). */
export function centsToReais(cents: Cents): number {
  return cents / 100;
}

const brlFormatter = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
});

/** Formata centavos como "R$ 1.234,56". */
export function formatBRL(cents: Cents): string {
  return brlFormatter.format(centsToReais(cents));
}

/** Soma uma lista de centavos com segurança. */
export function sumCents(values: Cents[]): Cents {
  return values.reduce((acc, v) => acc + v, 0);
}

/**
 * Distribui um total em N partes iguais em centavos, sem perder nem criar centavos.
 * O resto é adicionado às PRIMEIRAS parcelas (padrão do mercado brasileiro:
 * a 1ª parcela costuma ser a "mais cara").
 *
 * Ex.: distribute(12050, 3) => [4017, 4017, 4016]  (soma = 12050)
 */
export function distribute(total: Cents, parts: number): Cents[] {
  if (parts <= 0 || !Number.isInteger(parts)) {
    throw new Error(`Número de parcelas inválido: ${parts}`);
  }
  assertCents(total);
  const base = Math.floor(Math.abs(total) / parts);
  const remainder = Math.abs(total) - base * parts;
  const sign = Math.sign(total) || 1;
  return Array.from({ length: parts }, (_, i) => sign * (base + (i < remainder ? 1 : 0)));
}
