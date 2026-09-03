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
