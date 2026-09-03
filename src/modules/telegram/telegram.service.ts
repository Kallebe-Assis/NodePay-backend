import type { PrismaClient } from '@prisma/client';
import { env } from '../../config/env.js';
import { Errors } from '../../lib/errors.js';
import type { GeneratedReport } from '../reports/reports.service.js';

/**
 * Integração mínima com o Telegram. O bot roda no worker (modules/jobs) em
 * modo long-polling; aqui só usamos a API HTTP para enviar mensagens/arquivos.
 */
let botApi: { sendMessage: Function; sendDocument: Function } | null = null;

async function getBotApi() {
  if (!env.TELEGRAM_BOT_TOKEN) throw Errors.badRequest('TELEGRAM_BOT_TOKEN não configurado');
  if (botApi) return botApi;
  const { Bot } = await import('grammy');
  botApi = new Bot(env.TELEGRAM_BOT_TOKEN).api as any;
  return botApi!;
}

async function chatIdFor(db: PrismaClient, userId: string): Promise<string> {
  const s = await db.userSettings.findUnique({ where: { userId } });
  if (!s?.telegramEnabled || !s.telegramChatId) {
    throw Errors.badRequest('Telegram não vinculado. Configure em Configurações.');
  }
  return s.telegramChatId;
}

export async function sendMessage(db: PrismaClient, userId: string, text: string) {
  const api = await getBotApi();
  await api.sendMessage(await chatIdFor(db, userId), text, { parse_mode: 'HTML' });
}

export async function deliverDocument(db: PrismaClient, userId: string, report: GeneratedReport) {
  const api = await getBotApi();
  const { InputFile } = await import('grammy');
  await api.sendDocument(
    await chatIdFor(db, userId),
    new InputFile(report.body, report.filename),
    { caption: 'Relatório NodePay' },
  );
}
