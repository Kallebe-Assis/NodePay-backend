import PDFDocument from 'pdfkit';

/**
 * Geração de PDF **sem navegador**.
 *
 * Antes disso usava `puppeteer-core` apontando pra um Chrome/Edge já
 * instalado na máquina — funcionava no dev (Windows quase sempre tem Edge),
 * mas quebrava em produção (Render não vem com Chrome, e baixar um Chromium
 * inteiro só pra imprimir uma tabela é pesado e frágil). `pdfkit` desenha o
 * PDF diretamente (texto, linhas, retângulos) sem nenhum binário externo —
 * roda igual em qualquer máquina, inclusive a de produção.
 */

export interface PdfColumn {
  header: string;
  /** peso relativo da largura da coluna (padrão 1 — a 1ª coluna costuma pedir mais, ex.: 2.5) */
  width?: number;
  align?: 'left' | 'right';
}

export interface PdfTableSection {
  /** título da seção, quando o PDF tem mais de uma tabela (ex.: "Despesas por categoria") */
  heading?: string;
  columns: PdfColumn[];
  rows: string[][];
  /** linha de totais, em negrito, com régua por cima — mesmo número de colunas */
  footRow?: string[];
}

export interface PdfReportSpec {
  title: string;
  subtitle: string;
  generatedAt: string;
  sections: PdfTableSection[];
}

const MARGIN = 40;
const FONT_BODY = 9;
const FONT_HEAD = 8;
const ROW_PAD_X = 5;
const ROW_PAD_Y = 5;
const HEAD_ROW_H = 20;
const MIN_ROW_H = 16;

const COLOR = {
  text: '#16204a',
  faint: '#5b6488',
  headBg: '#eef2ff',
  border: '#e6e9f5',
  brand: '#12d2c8',
  neg: '#d6336c',
};

/** Monta o PDF do relatório (cabeçalho + 1+ tabelas) e devolve o Buffer final. */
export function renderPdf(spec: PdfReportSpec): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  drawHeader(doc, spec);
  for (const section of spec.sections) {
    if (section.heading) drawSectionHeading(doc, section.heading);
    drawTable(doc, section);
  }
  stampFooterOnEveryPage(doc, spec.generatedAt);

  doc.end();
  return done;
}

function drawHeader(doc: PDFKit.PDFDocument, spec: PdfReportSpec): void {
  const usableWidth = doc.page.width - MARGIN * 2;
  const y = doc.y;
  doc.rect(MARGIN, y, usableWidth, 3).fill(COLOR.brand);
  doc.y = y + 12;
  doc.fillColor(COLOR.text).font('Helvetica-Bold').fontSize(18).text(spec.title, MARGIN, doc.y);
  doc.fillColor(COLOR.faint).font('Helvetica').fontSize(10).text(spec.subtitle, MARGIN, doc.y + 4);
  doc.moveDown(1.2);
}

function drawSectionHeading(doc: PDFKit.PDFDocument, heading: string): void {
  if (doc.y > doc.page.height - MARGIN - 60) doc.addPage();
  doc.moveDown(0.4);
  doc.fillColor(COLOR.text).font('Helvetica-Bold').fontSize(12).text(heading, MARGIN, doc.y);
  doc.moveDown(0.3);
}

function stampFooterOnEveryPage(doc: PDFKit.PDFDocument, generatedAt: string): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Escrever dentro da margem inferior faria o pdfkit "auto-paginar" (achar
    // que o texto não coube e criar mais uma página só pro rodapé). Zerar a
    // margem de baixo por um instante evita isso — é o jeito padrão de
    // carimbar rodapé no pdfkit.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - MARGIN + 6;
    doc
      .fillColor(COLOR.faint)
      .font('Helvetica')
      .fontSize(8)
      .text(`NodePay · gerado em ${generatedAt} · página ${i + 1} de ${range.count}`, MARGIN, y, {
        width: doc.page.width - MARGIN * 2,
        align: 'center',
      });
    doc.page.margins.bottom = bottom;
  }
}

/** Desenha uma tabela com cabeçalho repetido a cada página e altura de linha
 * dinâmica (célula com texto longo quebra em várias linhas). */
function drawTable(doc: PDFKit.PDFDocument, section: PdfTableSection): void {
  const usableWidth = doc.page.width - MARGIN * 2;
  const weights = section.columns.map((c) => c.width ?? 1);
  const totalWeight = weights.reduce((s, w) => s + w, 0) || 1;
  const colWidths = weights.map((w) => (w / totalWeight) * usableWidth);
  const cellWidth = (i: number) => colWidths[i]! - ROW_PAD_X * 2;

  const drawHeadRow = () => {
    const y = doc.y;
    doc.rect(MARGIN, y, usableWidth, HEAD_ROW_H).fill(COLOR.headBg);
    let x = MARGIN;
    doc.font('Helvetica-Bold').fontSize(FONT_HEAD).fillColor(COLOR.text);
    section.columns.forEach((col, i) => {
      doc.text(col.header.toUpperCase(), x + ROW_PAD_X, y + 6, {
        width: cellWidth(i),
        align: col.align ?? 'left',
      });
      x += colWidths[i]!;
    });
    doc.y = y + HEAD_ROW_H;
  };

  const ensureSpace = (h: number) => {
    if (doc.y + h > doc.page.height - MARGIN - 20) {
      doc.addPage();
      drawHeadRow();
    }
  };

  drawHeadRow();

  const drawRow = (cells: string[], opts: { bold?: boolean; ruleAbove?: boolean } = {}) => {
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(FONT_BODY);
    const heights = cells.map((text, i) => doc.heightOfString(text || '—', { width: cellWidth(i) }));
    const rowHeight = Math.max(...heights, MIN_ROW_H) + ROW_PAD_Y * 2;
    ensureSpace(rowHeight);
    const y = doc.y;

    if (opts.ruleAbove) {
      doc.moveTo(MARGIN, y).lineTo(MARGIN + usableWidth, y).lineWidth(1).strokeColor(COLOR.text).stroke();
    }

    let x = MARGIN;
    cells.forEach((text, i) => {
      const negative = text.trim().startsWith('-');
      doc.fillColor(negative ? COLOR.neg : COLOR.text);
      doc.text(text || '—', x + ROW_PAD_X, y + ROW_PAD_Y, {
        width: cellWidth(i),
        align: section.columns[i]?.align ?? 'left',
      });
      x += colWidths[i]!;
    });

    doc.y = y + rowHeight;
    doc
      .moveTo(MARGIN, doc.y)
      .lineTo(MARGIN + usableWidth, doc.y)
      .lineWidth(0.5)
      .strokeColor(COLOR.border)
      .stroke();
  };

  if (section.rows.length === 0) {
    drawRow(['Nada neste período', ...Array(Math.max(section.columns.length - 1, 0)).fill('')]);
  } else {
    for (const row of section.rows) drawRow(row);
  }
  if (section.footRow) drawRow(section.footRow, { bold: true, ruleAbove: true });
  doc.moveDown(1);
}
