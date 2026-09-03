import { accessSync, constants } from 'node:fs';
import { execSync } from 'node:child_process';
import { platform } from 'node:os';
import { env } from '../../config/env.js';

/**
 * Descoberta do executável do Chromium/Chrome/Edge para a geração de PDF.
 *
 * O projeto usa `puppeteer-core` (não baixa navegador no `npm install`), então
 * precisamos apontar para um binário já instalado na máquina. Em vez de exigir
 * a variável `PUPPETEER_EXECUTABLE_PATH`, este módulo procura nos caminhos
 * usuais de cada sistema operacional — no Windows o Edge quase sempre existe,
 * então o PDF "simplesmente funciona".
 */

/** Resultado memoizado de {@link resolveChromiumPath} (`undefined` = ainda não procurado). */
let cachedPath: string | null | undefined;

/**
 * Monta a lista de candidatos a executável, em ordem de preferência, para o SO atual.
 * Variáveis de ambiente sempre vêm primeiro.
 */
function candidatePaths(): string[] {
  const os = platform();
  const paths: string[] = [];

  // 1) Variáveis de ambiente explícitas têm prioridade absoluta.
  for (const fromEnv of [
    env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    process.env.CHROMIUM_PATH,
  ]) {
    if (fromEnv) paths.push(fromEnv);
  }

  // 2) Caminhos típicos de instalação por sistema operacional.
  if (os === 'win32') {
    const programFiles = process.env.PROGRAMFILES ?? 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA ?? '';
    paths.push(
      `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
      `${localAppData}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${programFilesX86}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${programFiles}\\Chromium\\Application\\chrome.exe`,
    );
  } else if (os === 'darwin') {
    paths.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    );
  } else {
    // Linux: primeiro tenta resolver pelo PATH, depois caminhos fixos comuns.
    for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
      try {
        const resolved = execSync(`command -v ${bin}`, {
          stdio: ['ignore', 'pipe', 'ignore'],
        })
          .toString()
          .trim();
        if (resolved) paths.push(resolved);
      } catch {
        /* binário não está no PATH — segue para o próximo */
      }
    }
    paths.push(
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    );
  }

  return paths;
}

/**
 * Retorna o caminho do primeiro navegador Chromium/Chrome/Edge encontrado, ou
 * `null` se nenhum existir. O resultado é memoizado por processo.
 */
export function resolveChromiumPath(): string | null {
  if (cachedPath !== undefined) return cachedPath;

  for (const candidate of candidatePaths()) {
    try {
      accessSync(candidate, constants.F_OK); // basta existir; no Windows não há bit de execução
      cachedPath = candidate;
      return candidate;
    } catch {
      /* não existe — tenta o próximo candidato */
    }
  }

  cachedPath = null;
  return null;
}
