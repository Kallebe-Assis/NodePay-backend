import { formatBRL, formatShortDate } from '@nodepay/shared';

function escapeCsv(value: string): string {
  if (/[";\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export interface StatementRow {
  competenceDate: string;
  dueDate: string;
  paidDate: string | null;
  type: string;
  description: string;
  category: string;
  account: string;
  status: string;
  amount: number; // centavos (com sinal)
}

/** CSV com ; (padrão pt-BR para abrir no Excel) e BOM UTF-8. */
export function buildStatementCsv(rows: StatementRow[]): Buffer {
  const header = [
    'Competência',
    'Vencimento',
    'Pagamento',
    'Tipo',
    'Descrição',
    'Categoria',
    'Conta',
    'Status',
    'Valor',
  ].join(';');

  const lines = rows.map((r) =>
    [
      formatShortDate(r.competenceDate as any),
      formatShortDate(r.dueDate as any),
      r.paidDate ? formatShortDate(r.paidDate as any) : '',
      r.type,
      escapeCsv(r.description),
      escapeCsv(r.category),
      escapeCsv(r.account),
      r.status,
      formatBRL(r.amount),
    ].join(';'),
  );

  return Buffer.from('﻿' + [header, ...lines].join('\r\n'), 'utf8');
}
