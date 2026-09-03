/**
 * Ponte entre o BigInt (centavos) do Prisma e o number (centavos) da API/DTO.
 * Valores pessoais cabem com folga em Number.MAX_SAFE_INTEGER (~90 trilhões
 * de reais), então trafegamos como number no JSON.
 */
export function bigToNum(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error(`Valor monetário fora do intervalo seguro: ${value}`);
  }
  return Number(value);
}

export function numToBig(value: number): bigint {
  if (!Number.isInteger(value)) {
    throw new Error(`Valor monetário deve ser inteiro em centavos: ${value}`);
  }
  return BigInt(value);
}

export const nb = (v: bigint | null | undefined): number => (v == null ? 0 : bigToNum(v));
