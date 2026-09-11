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
import { renderPdf, type PdfTableSection } from './pdf.js';

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

/** Rótulo humano de cada status, usado nas colunas do PDF/CSV. */
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pendente',
  SCHEDULED: 'Agendado',
  PARTIAL: 'Parcial',
  PAID: 'Pago',
  CANCELED: 'Cancelado',
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

    // 3) PDF: uma tabela com o rodapé de totais.
    const totalIn = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
    const totalOut = rows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);

    const body = await renderPdf({
      title: 'Extrato NodePay',
      subtitle: `Período de ${formatLongDate(q.from as never)} a ${formatLongDate(q.to as never)}`,
      generatedAt: formatShortDate(todaySP()),
      sections: [
        {
          columns: [
            { header: 'Competência', width: 1.1 },
            { header: 'Descrição', width: 2.4 },
            { header: 'Categoria', width: 1.3 },
            { header: 'Conta', width: 1.3 },
            { header: 'Status', width: 1 },
            { header: 'Valor', width: 1.1, align: 'right' },
          ],
          rows: rows.map((r) => [
            formatShortDate(r.competenceDate as never),
            r.description,
            r.category,
            r.account,
            STATUS_LABEL[r.status] ?? r.status,
            formatBRL(r.amount),
          ]),
          footRow: [
            '',
            `Entradas ${formatBRL(totalIn)} · Saídas ${formatBRL(totalOut)}`,
            '',
            '',
            '',
            formatBRL(totalIn + totalOut),
          ],
        },
      ],
    });

    return { filename: `${base}.pdf`, contentType: 'application/pdf', body };
  }

  /**
   * Versão do relatório em **texto** (HTML do Telegram) — para enviar como
   * mensagem no chat em vez de arquivo. Sempre abaixo do limite de 4096 chars.
   */
  async generateText(
    userId: string,
    q: GenerateReportQuery,
  ): Promise<{ text: string; label: string }> {
    const periodo = `${formatShortDate(q.from as never)} — ${formatShortDate(q.to as never)}`;
    let label: string;
    let body: string;

    if (q.kind === 'monthly') {
      label = 'Fechamento mensal';
      const txns = await this.db.transaction.findMany({
        where: {
          userId,
          status: { not: 'CANCELED' },
          competenceDate: { gte: isoToDbDate(q.from), lte: isoToDbDate(q.to) },
        },
        select: { amount: true, type: true, competenceDate: true },
      });
      const inc = new Map<string, number>();
      const exp = new Map<string, number>();
      for (const t of txns) {
        const m = dbDateToIso(t.competenceDate).slice(0, 7);
        if (INFLOW_TYPES.includes(t.type)) inc.set(m, (inc.get(m) ?? 0) + nb(t.amount));
        else if (OUTFLOW_TYPES.includes(t.type)) exp.set(m, (exp.get(m) ?? 0) + nb(t.amount));
      }
      const rows = this.monthsInRange(q.from, q.to).map((m) => {
        const i = inc.get(m) ?? 0;
        const e = exp.get(m) ?? 0;
        return { m, i, e, net: i - e };
      });
      const tot = rows.reduce((a, r) => ({ i: a.i + r.i, e: a.e + r.e, net: a.net + r.net }), {
        i: 0,
        e: 0,
        net: 0,
      });
      body =
        `<i>receitas · despesas · resultado</i>\n` +
        rows
          .map(
            (r) =>
              `<b>${r.m}</b>  ${formatBRL(r.i)} · ${formatBRL(r.e)} · ${signBRL(r.net)}`,
          )
          .join('\n') +
        `\n\n<b>Total</b>  ${formatBRL(tot.i)} · ${formatBRL(tot.e)} · ${signBRL(tot.net)}`;
    } else if (q.kind === 'by-category') {
      label = 'Gasto por categoria';
      const txns = await this.db.transaction.findMany({
        where: {
          userId,
          status: { not: 'CANCELED' },
          competenceDate: { gte: isoToDbDate(q.from), lte: isoToDbDate(q.to) },
          ...(q.accountId ? { accountId: q.accountId } : {}),
          ...(q.creditCardId ? { creditCardId: q.creditCardId } : {}),
        },
        select: { amount: true, type: true, category: { select: { name: true } } },
      });
      const expByCat = new Map<string, number>();
      const incByCat = new Map<string, number>();
      for (const t of txns) {
        const name = t.category?.name ?? 'Sem categoria';
        if (OUTFLOW_TYPES.includes(t.type))
          expByCat.set(name, (expByCat.get(name) ?? 0) + nb(t.amount));
        else if (INFLOW_TYPES.includes(t.type))
          incByCat.set(name, (incByCat.get(name) ?? 0) + nb(t.amount));
      }
      const top = (m: Map<string, number>, n: number) =>
        [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
      const expTotal = [...expByCat.values()].reduce((s, v) => s + v, 0);
      const incTotal = [...incByCat.values()].reduce((s, v) => s + v, 0);
      const dump = (title: string, rows: [string, number][], total: number) =>
        `<b>${escapeHtml(title)}</b>\n` +
        (rows.length
          ? rows.map(([c, v]) => `• ${escapeHtml(c)} — ${formatBRL(v)}`).join('\n')
          : '<i>nada no período</i>') +
        `\n<b>Total ${formatBRL(total)}</b>`;
      body = `${dump('Despesas por categoria', top(expByCat, 12), expTotal)}\n\n${dump(
        'Receitas por categoria',
        top(incByCat, 6),
        incTotal,
      )}`;
    } else {
      label = 'Extrato de lançamentos';
      const rows = await this.loadStatement(userId, q);
      const totalIn = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
      const totalOut = rows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);
      const top = [...rows]
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
        .slice(0, 15);
      body =
        `<b>${rows.length}</b> lançamento(s)\n` +
        `Entradas: ${formatBRL(totalIn)}\n` +
        `Saídas: ${formatBRL(totalOut)}\n` +
        `Saldo: ${signBRL(totalIn + totalOut)}\n\n` +
        `<b>Maiores lançamentos</b>\n` +
        top
          .map(
            (r) =>
              `• ${escapeHtml(r.description)} — ${signBRL(r.amount)}` +
              (r.category ? ` <i>(${escapeHtml(r.category)})</i>` : ''),
          )
          .join('\n') +
        (rows.length > top.length ? `\n… e mais ${rows.length - top.length} lançamento(s)` : '');
    }

    let text = `📊 <b>${label}</b>\n${periodo}\n\n${body}\n\n<i>NodePay · gerado em ${formatShortDate(
      todaySP(),
    )}</i>`;
    // Telegram: limite de 4096 chars por mensagem.
    if (text.length > 3900) text = text.slice(0, 3880) + '\n…';
    return { text, label };
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

    const pdfSection = (s: ReturnType<typeof section>): PdfTableSection => ({
      heading: s.title,
      columns: [
        { header: 'Categoria', width: 1.6 },
        ...s.head.slice(1, -1).map((h) => ({ header: h, width: 1, align: 'right' as const })),
        { header: 'Total', width: 1.2, align: 'right' as const },
      ],
      rows: s.lines.map((l) => [l.c, ...l.vals.map((v) => formatBRL(v)), formatBRL(l.total)]),
      footRow: ['Total', ...s.totalRow.map((v) => formatBRL(v)), formatBRL(s.grand)],
    });
    const body = await renderPdf({
      title: 'Gasto por categoria',
      subtitle: `${formatLongDate(q.from as never)} a ${formatLongDate(q.to as never)}`,
      generatedAt: formatShortDate(todaySP()),
      sections: [pdfSection(secExp), pdfSection(secInc)],
    });
    return { filename: `${base}.pdf`, contentType: 'application/pdf', body };
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

    const body = await renderPdf({
      title: 'Fechamento mensal',
      subtitle: `${formatLongDate(q.from as never)} a ${formatLongDate(q.to as never)}`,
      generatedAt: formatShortDate(todaySP()),
      sections: [
        {
          columns: [
            { header: 'Mês', width: 1 },
            { header: 'Receitas', width: 1, align: 'right' },
            { header: 'Despesas', width: 1, align: 'right' },
            { header: 'Resultado', width: 1, align: 'right' },
          ],
          rows: rows.map((r) => [r.m, formatBRL(r.i), formatBRL(r.e), formatBRL(r.net)]),
          footRow: ['Total', formatBRL(tot.i), formatBRL(tot.e), formatBRL(tot.net)],
        },
      ],
    });
    return { filename: `${base}.pdf`, contentType: 'application/pdf', body };
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

/** "R$ 1.234,56" com sinal explícito (+/−) — usado nos textos do Telegram. */
function signBRL(cents: number): string {
  const s = cents < 0 ? '−' : '+';
  return `${s} ${formatBRL(Math.abs(cents))}`;
}
