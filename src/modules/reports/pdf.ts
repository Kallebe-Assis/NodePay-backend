import { Errors } from '../../lib/errors.js';
import { resolveChromiumPath } from './chromium.js';

/**
 * Renderização de HTML → PDF.
 *
 * Usa `puppeteer-core` (o `npm install` não baixa navegador nenhum) apontando
 * para um Chrome/Edge/Chromium já instalado — descoberto automaticamente por
 * {@link resolveChromiumPath}. Se nada for encontrado, retorna um 400 com
 * instruções em vez de estourar.
 */
export async function renderPdf(html: string): Promise<Buffer> {
  // 1) Descobre o navegador (env explícito ou caminhos usuais do SO).
  const executablePath = resolveChromiumPath();
  if (!executablePath) {
    throw Errors.badRequest(
      'Geração de PDF indisponível: nenhum Chrome, Edge ou Chromium foi encontrado nesta máquina. ' +
        'Instale o Google Chrome ou defina PUPPETEER_EXECUTABLE_PATH no .env com o caminho do executável.',
    );
  }

  // 2) Sobe o navegador headless só para esta renderização.
  const { launch } = await import('puppeteer-core');
  const browser = await launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    // 3) Injeta o HTML, espera a rede assentar e imprime em A4.
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', bottom: '18mm', left: '14mm', right: '14mm' },
    });
    return Buffer.from(pdf);
  } finally {
    // 4) Sempre fecha o navegador, mesmo em erro.
    await browser.close();
  }
}

/**
 * Monta o HTML do relatório de **extrato** (a única saída em PDF por enquanto).
 * Estilo inline para não depender de assets externos ao imprimir.
 */
export function statementHtml(params: {
  title: string;
  subtitle: string;
  generatedAt: string;
  totalsRow: string;
  bodyRows: string;
}): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<style>
  * { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  body { color: #16204a; font-size: 12px; }
  header { border-bottom: 3px solid #12d2c8; padding-bottom: 10px; margin-bottom: 16px; }
  h1 { margin: 0; font-size: 20px; color: #0e1633; }
  .sub { color: #5b6488; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; background: #eef2ff; padding: 6px 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  td { padding: 6px 8px; border-bottom: 1px solid #e6e9f5; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: 700; border-top: 2px solid #16204a; }
  .neg { color: #d6336c; }
  footer { position: fixed; bottom: 0; left: 0; right: 0; color: #8b93b8; font-size: 10px; }
</style></head><body>
<header>
  <h1>${params.title}</h1>
  <div class="sub">${params.subtitle}</div>
</header>
<table>
  <thead><tr>
    <th>Competência</th><th>Descrição</th><th>Categoria</th><th>Conta</th><th>Status</th><th class="num">Valor</th>
  </tr></thead>
  <tbody>${params.bodyRows}</tbody>
  <tfoot>${params.totalsRow}</tfoot>
</table>
<footer>NodePay · gerado em ${params.generatedAt}</footer>
</body></html>`;
}
