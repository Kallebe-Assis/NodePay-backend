import type { PrismaClient } from '@prisma/client';
import {
  formatBRL,
  formatLongDate,
  formatShortDate,
  type GenerateReportQuery,
  INFLOW_TYPES,
  OUTFLOW_TYPES,
  todaySP,
} from '@nodepay/shared';
import { nb } from '../../lib/money.js';
import { dbDateToIso, isoToDbDate } from '../../lib/date.js';
import { buildStatementCsv, type StatementRow } from './csv.js';
import { renderPdf, statementHtml } from './pdf.js';

/** Rótulo humano de cada tipo de lançamento, usado nas colunas do relatório. */
const TYPE_LABEL: Record<string, string> = {
  EXPENSE: 'Despesa',
  INCOME: 'Receita',
  TRANSFER: 'Transferência',
  CARD_EXPENSE: 'Compra no cartão',
  INVOICE_PAYMENT: 'Pagamento de fatura',
  LOAN_DISBURSEMENT: 'Empréstimo (crédito)',
  LOAN_INSTALLMENT: 'Parcela de empréstimo',
};

/** Arquivo pronto para download ou envio (o `body` já é o conteúdo final). */
export interface GeneratedReport {
  filename: string;
  contentType: string;
  body: Buffer;
}

/**
 * Geração de relatórios. Hoje todos os tipos reaproveitam o **extrato de
 * lançamentos** como base; a diferenciação por `kind` (mensal, por categoria…)
 * está no roadmap.
 */
export class ReportsService {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Gera o relatório pedido e devolve o arquivo (CSV ou PDF).
   * @param userId dono dos dados (já resolvido pelo escopo/RBAC na rota).
   */
  async generate(userId: string, q: GenerateReportQuery): Promise<GeneratedReport> {
    if (q.kind === 'by-category') return this.byCategory(userId, q);
    if (q.kind === 'monthly') return this.monthlySummary(userId, q);

    // 1) Carrega as linhas do período (mesma consulta para CSV e PDF).
    const rows = await this.loadStatement(userId, q);
    const base = `nodepay-${q.kind}-${q.from}_a_${q.to}`;

    // 2) CSV: delega a montagem (separador ';' + BOM) para o helper.
    if (q.format === 'csv') {
      return {
        filename: `${base}.csv`,
        contentType: 'text/csv; charset=utf-8',
        body: buildStatementCsv(rows),
      };
    }

    // 3) PDF: monta as linhas e o rodapé de totais em HTML e renderiza.
    const totalIn = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
    const totalOut = rows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);

    const bodyRows = rows
      .map(
        (r) => `<tr>
        <td>${formatShortDate(r.competenceDate as any)}</td>
        <td>${escapeHtml(r.description)}</td>
        <td>${escapeHtml(r.category)}</td>
        <td>${escapeHtml(r.account)}</td>
        <td>${r.status}</td>
        <td class="num ${r.amount < 0 ? 'neg' : ''}">${formatBRL(r.amount)}</td>
      </tr>`,
      )
      .join('');

    const totalsRow = `<tr>
      <td colspan="5">Entradas ${formatBRL(totalIn)} · Saídas ${formatBRL(totalOut)}</td>
      <td class="num">${formatBRL(totalIn + totalOut)}</td>
    </tr>`;

    const html = statementHtml({
      title: 'Extrato NodePay',
      subtitle: `Período de ${formatLongDate(q.from as any)} a ${formatLongDate(q.to as any)}`,
      generatedAt: formatShortDate(todaySP()),
      bodyRows,
      totalsRow,
    });

    return {
      filename: `${base}.pdf`,
      contentType: 'application/pdf',
      body: await renderPdf(html),
    };
  }

  /** Meses "YYYY-MM" entre from e to (inclusive). */
  private monthsInRange(from: string, to: string): string[] {
    const out: string[] = [];
    let cur = from.slice(0, 7);
    const end = to.slice(0, 7);
    while (cur <= end) {
      out.push(cur);
      const [y, m] = cur.split('-').map(Number) as [number, number];
      cur = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    }
    return out;
  }

  /** Relatório "gasto por categoria": matriz categoria × mês (despesas e receitas). */
  private async byCategory(userId: string, q: GenerateReportQuery): Promise<GeneratedReport> {
    const txns = await this.db.transaction.findMany({
      where: {
        userId,
        status: { not: 'CANCELED' },
        competenceDate: { gte: isoToDbDate(q.from), lte: isoToDbDate(q.to) },
        ...(q.accountId ? { accountId: q.accountId } : {}),
        ...(q.creditCardId ? { creditCardId: q.creditCardId } : {}),
      },
      select: { amount: true, type: true, competenceDate: true, category: { select: { name: true } } },
    });

    const months = this.monthsInRange(q.from, q.to);
    type Bucket = Map<string, Map<string, number>>; // categoria -> mês -> centavos
    const expense: Bucket = new Map();
    const income: Bucket = new Map();
    const put = (b: Bucket, cat: string, month: string, v: number) => {
      const row = b.get(cat) ?? new Map<string, number>();
      row.set(month, (row.get(month) ?? 0) + v);
      b.set(cat, row);
    };
    for (const t of txns) {
      const name = t.category?.name ?? 'Sem categoria';
      const month = dbDateToIso(t.competenceDate).slice(0, 7);
      if (INFLOW_TYPES.includes(t.type)) put(income, name, month, nb(t.amount));
      else if (OUTFLOW_TYPES.includes(t.type)) put(expense, name, month, nb(t.amount));
    }

    const section = (title: string, b: Bucket) => {
      const cats = [...b.keys()].sort();
      const head = ['Categoria', ...months, 'Total'];
      const lines = cats.map((c) => {
        const row = b.get(c)!;
        const vals = months.map((m) => row.get(m) ?? 0);
        const total = vals.reduce((s, v) => s + v, 0);
        return { c, vals, total };
      });
      const totalRow = months.map((m) =>
        lines.reduce((s, l) => s + (l.vals[months.indexOf(m)] ?? 0), 0),
      );
      return { title, head, lines, totalRow, grand: totalRow.reduce((s, v) => s + v, 0) };
    };
    const secExp = section('Despesas por categoria', expense);
    const secInc = section('Receitas por categoria', income);
    const base = `nodepay-por-categoria-${q.from}_a_${q.to}`;

    if (q.format === 'csv') {
      const esc = (s: string) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
      const dump = (s: ReturnType<typeof section>) =>
        [
          s.title,
          s.head.join(';'),
          ...s.lines.map((l) => [esc(l.c), ...l.vals.map(centsBR), centsBR(l.total)].join(';')),
          ['Total', ...s.totalRow.map(centsBR), centsBR(s.grand)].join(';'),
        ].join('\r\n');
      return {
        filename: `${base}.csv`,
        contentType: 'text/csv; charset=utf-8',
        body: Buffer.from('﻿' + [dump(secExp), '', dump(secInc)].join('\r\n'), 'utf8'),
      };
    }

    const table = (s: ReturnType<typeof section>) => `
      <h2>${escapeHtml(s.title)}</h2>
      <table><thead><tr>${s.head.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
      <tbody>
        ${s.lines
          .map(
            (l) =>
              `<tr><td>${escapeHtml(l.c)}</td>${l.vals
                .map((v) => `<td class="num">${formatBRL(v)}</td>`)
                .join('')}<td class="num">${formatBRL(l.total)}</td></tr>`,
          )
          .join('')}
        <tr><td>Total</td>${s.totalRow
          .map((v) => `<td class="num">${formatBRL(v)}</td>`)
          .join('')}<td class="num">${formatBRL(s.grand)}</td></tr>
      </tbody></table>`;
    const html = genericReportHtml(
      'Gasto por categoria',
      `${formatLongDate(q.from as never)} a ${formatLongDate(q.to as never)}`,
      table(secExp) + table(secInc),
    );
    return { filename: `${base}.pdf`, contentType: 'application/pdf', body: await renderPdf(html) };
  }

  /** Relatório "fechamento do mês": receitas, despesas e resultado por mês. */
  private async monthlySummary(userId: string, q: GenerateReportQuery): Promise<GeneratedReport> {
    const txns = await this.db.transaction.findMany({
      where: {
        userId,
        status: { not: 'CANCELED' },
        competenceDate: { gte: isoToDbDate(q.from), lte: isoToDbDate(q.to) },
      },
      select: { amount: true, type: true, competenceDate: true },
    });
    const months = this.monthsInRange(q.from, q.to);
    const inc = new Map<string, number>();
    const exp = new Map<string, number>();
    for (const t of txns) {
      const m = dbDateToIso(t.competenceDate).slice(0, 7);
      if (INFLOW_TYPES.includes(t.type)) inc.set(m, (inc.get(m) ?? 0) + nb(t.amount));
      else if (OUTFLOW_TYPES.includes(t.type)) exp.set(m, (exp.get(m) ?? 0) + nb(t.amount));
    }
    const rows = months.map((m) => {
      const i = inc.get(m) ?? 0;
      const e = exp.get(m) ?? 0;
      return { m, i, e, net: i - e };
    });
    const tot = rows.reduce((a, r) => ({ i: a.i + r.i, e: a.e + r.e, net: a.net + r.net }), {
      i: 0,
      e: 0,
      net: 0,
    });
    const base = `nodepay-mensal-${q.from}_a_${q.to}`;

    if (q.format === 'csv') {
      const body = [
        'Mês;Receitas;Despesas;Resultado',
        ...rows.map((r) => [r.m, centsBR(r.i), centsBR(r.e), centsBR(r.net)].join(';')),
        ['Total', centsBR(tot.i), centsBR(tot.e), centsBR(tot.net)].join(';'),
      ].join('\r\n');
      return {
        filename: `${base}.csv`,
        contentType: 'text/csv; charset=utf-8',
        body: Buffer.from('﻿' + body, 'utf8'),
      };
    }

    const html = genericReportHtml(
      'Fechamento mensal',
      `${formatLongDate(q.from as never)} a ${formatLongDate(q.to as never)}`,
      `<table><thead><tr><th>Mês</th><th>Receitas</th><th>Despesas</th><th>Resultado</th></tr></thead>
      <tbody>
        ${rows
          .map(
            (r) =>
              `<tr><td>${r.m}</td><td class="num">${formatBRL(r.i)}</td><td class="num">${formatBRL(
                r.e,
              )}</td><td class="num ${r.net < 0 ? 'neg' : ''}">${formatBRL(r.net)}</td></tr>`,
          )
          .join('')}
        <tr><td>Total</td><td class="num">${formatBRL(tot.i)}</td><td class="num">${formatBRL(
          tot.e,
        )}</td><td class="num ${tot.net < 0 ? 'neg' : ''}">${formatBRL(tot.net)}</td></tr>
      </tbody></table>`,
    );
    return { filename: `${base}.pdf`, contentType: 'application/pdf', body: await renderPdf(html) };
  }

  /**
   * Busca os lançamentos do período (com os filtros opcionais) e normaliza cada
   * um numa {@link StatementRow} com valor **assinado** (entrada +, saída −).
   */
  private async loadStatement(userId: string, q: GenerateReportQuery): Promise<StatementRow[]> {
    const txns = await this.db.transaction.findMany({
      where: {
        userId,
        status: { not: 'CANCELED' },
        competenceDate: { gte: isoToDbDate(q.from), lte: isoToDbDate(q.to) },
        ...(q.accountId ? { accountId: q.accountId } : {}),
        ...(q.creditCardId ? { creditCardId: q.creditCardId } : {}),
        ...(q.categoryId ? { categoryId: q.categoryId } : {}),
        ...(q.type ? { type: q.type } : {}),
      },
      orderBy: [{ competenceDate: 'asc' }, { createdAt: 'asc' }],
      include: {
        category: { select: { name: true } },
        account: { select: { name: true } },
        creditCard: { select: { name: true } },
      },
    });

    return txns.map((t) => {
      // Sinal a partir do tipo: entradas positivas, saídas negativas.
      const magnitude = nb(t.amount);
      const signed = INFLOW_TYPES.includes(t.type)
        ? magnitude
        : OUTFLOW_TYPES.includes(t.type)
          ? -magnitude
          : magnitude;
      return {
        competenceDate: dbDateToIso(t.competenceDate),
        dueDate: dbDateToIso(t.dueDate),
        paidDate: t.paidDate ? dbDateToIso(t.paidDate) : null,
        type: TYPE_LABEL[t.type] ?? t.type,
        description: t.description,
        category: t.category?.name ?? '',
        account: t.account?.name ?? t.creditCard?.name ?? '',
        status: t.status,
        amount: signed,
      };
    });
  }
}

/** Escapa os 4 caracteres perigosos ao interpolar texto do usuário no HTML do PDF. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** centavos → "1234,56" (para célula de CSV pt-BR). */
function centsBR(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

/** HTML de um relatório genérico (tabelas livres) para impressão em PDF. */
function genericReportHtml(title: string, subtitle: string, bodyHtml: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
    * { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
    body { color: #16204a; font-size: 12px; margin: 0; }
    h1 { font-size: 18px; margin: 0 0 2px; }
    h2 { font-size: 14px; margin: 18px 0 6px; }
    .sub { color: #64748b; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 5px 7px; text-align: left; }
    th { background: #f1f5f9; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    td.neg { color: #dc2626; }
    tbody tr:last-child td { font-weight: 700; border-top: 2px solid #cbd5e1; }
  </style></head><body>
    <h1>${escapeHtml(title)}</h1>
    <div class="sub">${escapeHtml(subtitle)} · gerado em ${formatShortDate(todaySP())}</div>
    ${bodyHtml}
  </body></html>`;
}
