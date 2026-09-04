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

/**
 * Testa as credenciais do bot SEM exigir que já estejam salvas: os valores
 * passados em `override` têm prioridade sobre o que está em `UserSettings`
 * (assim dá pra testar antes de clicar em "Salvar" no formulário).
 */
export async function sendTestMessage(
  db: PrismaClient,
  userId: string,
  override: { botToken?: string; chatId?: string },
): Promise<void> {
  const s = await db.userSettings.findUnique({ where: { userId } });
  const token =
    override.botToken?.trim() ||
    (s?.telegramBotTokenEnc ? decryptSecret(s.telegramBotTokenEnc) : env.TELEGRAM_BOT_TOKEN);
  if (!token) {
    throw Errors.badRequest('Informe o token do bot (ou salve um antes de testar).');
  }
  const chatId = override.chatId?.trim() || s?.telegramChatId;
  if (!chatId) {
    throw Errors.badRequest('Informe o Chat ID (ou pareie o chat antes de testar).');
  }

  const api = await getBotApi(token);
  try {
    await api.sendMessage(
      chatId,
      '✅ <b>NodePay</b> — credenciais do Telegram funcionando!',
      { parse_mode: 'HTML' },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw Errors.badRequest(`Falha ao enviar pelo Telegram: ${msg}`);
  }
}

export async function deliverDocument(db: PrismaClient, userId: string, report: GeneratedReport) {
  const { token, chatId } = await resolveTelegram(db, userId);
  const api = await getBotApi(token);
  const { InputFile } = await import('grammy');
  await api.sendDocument(chatId, new InputFile(report.body, report.filename), {
    caption: 'Relatório NodePay',
  });
}
