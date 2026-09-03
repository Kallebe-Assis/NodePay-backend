import type { PrismaClient } from '@prisma/client';
import { env } from '../../config/env.js';
import { Errors } from '../../lib/errors.js';
import { decryptSecret } from '../../lib/crypto.js';
import type { GeneratedReport } from '../reports/reports.service.js';

/**
 * Integração mínima com o Telegram.
 *
 * O token do bot vem primeiro das Configurações do usuário
 * (`telegramBotTokenEnc`, criptografado) e, se não houver, do `TELEGRAM_BOT_TOKEN`
 * do ambiente. O chat pode ser pareado (`/vincular <token>`) ou informado
 * direto pelo usuário (Chat ID).
 */
type BotApi = { sendMessage: Function; sendDocument: Function };
const apiCache = new Map<string, BotApi>();

async function getBotApi(token: string): Promise<BotApi> {
  const cached = apiCache.get(token);
  if (cached) return cached;
  const { Bot } = await import('grammy');
  const api = new Bot(token).api as unknown as BotApi;
  apiCache.set(token, api);
  return api;
}

/** Resolve `{ token, chatId }` do usuário; lança 400 se faltar algo. */
async function resolveTelegram(db: PrismaClient, userId: string) {
  const s = await db.userSettings.findUnique({ where: { userId } });
  const token = s?.telegramBotTokenEnc
    ? decryptSecret(s.telegramBotTokenEnc)
    : env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw Errors.badRequest('Token do bot do Telegram não configurado (Configurações → Relatório).');
  }
  if (!s?.telegramEnabled || !s.telegramChatId) {
    throw Errors.badRequest('Telegram não vinculado. Informe o Chat ID ou faça o pareamento.');
  }
  return { token, chatId: s.telegramChatId };
}

export async function sendMessage(db: PrismaClient, userId: string, text: string) {
  const { token, chatId } = await resolveTelegram(db, userId);
  const api = await getBotApi(token);
  await api.sendMessage(chatId, text, { parse_mode: 'HTML' });
}

export async function deliverDocument(db: PrismaClient, userId: string, report: GeneratedReport) {
  const { token, chatId } = await resolveTelegram(db, userId);
  const api = await getBotApi(token);
  const { InputFile } = await import('grammy');
  await api.sendDocument(chatId, new InputFile(report.body, report.filename), {
    caption: 'Relatório NodePay',
  });
}
