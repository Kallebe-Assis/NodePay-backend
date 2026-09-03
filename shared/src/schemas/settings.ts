import { z } from 'zod';
import { BackupFrequency } from '../constants.js';

/**
 * Configurações por usuário. Segredos (chaves da Backblaze, token do Telegram)
 * NUNCA voltam em texto puro: a API devolve apenas flags "configured".
 */
export const backupSettingsInputSchema = z.object({
  enabled: z.boolean(),
  frequency: z.nativeEnum(BackupFrequency),
  retentionDays: z.number().int().min(1).max(365),
  s3Endpoint: z.string().url().optional().or(z.literal('')),
  region: z.string().max(40).optional(),
  bucket: z.string().max(120).optional(),
  keyId: z.string().max(200).optional(),
  appKey: z.string().max(400).optional(), // write-only
});
export type BackupSettingsInput = z.infer<typeof backupSettingsInputSchema>;

export const telegramSettingsInputSchema = z.object({
  enabled: z.boolean(),
  dailyDigest: z.boolean().default(false),
  digestHour: z.number().int().min(0).max(23).default(8),
  /** token do bot — write-only (sobrepõe o TELEGRAM_BOT_TOKEN do ambiente) */
  botToken: z.string().max(200).optional(),
  /** ID do chat — OPCIONAL; alternativa ao pareamento via /vincular */
  chatId: z.string().max(60).optional(),
});
export type TelegramSettingsInput = z.infer<typeof telegramSettingsInputSchema>;

export const notificationSettingsInputSchema = z.object({
  billsDue: z.boolean(),
  invoiceClosing: z.boolean(),
  lowBalance: z.boolean(),
  weeklySummary: z.boolean(),
  pendingUsers: z.boolean(),
  lowBalanceThreshold: z.number().int().nonnegative(), // centavos
});
export type NotificationSettingsInput = z.infer<typeof notificationSettingsInputSchema>;

export const appearanceSettingsInputSchema = z.object({
  themePref: z.enum(['system', 'light', 'dark']),
});
export type AppearanceSettingsInput = z.infer<typeof appearanceSettingsInputSchema>;

export const updateSettingsBodySchema = z.object({
  backup: backupSettingsInputSchema.partial().optional(),
  telegram: telegramSettingsInputSchema.partial().optional(),
  notifications: notificationSettingsInputSchema.partial().optional(),
  appearance: appearanceSettingsInputSchema.partial().optional(),
});
export type UpdateSettingsBody = z.infer<typeof updateSettingsBodySchema>;

export const settingsSchema = z.object({
  backup: z.object({
    enabled: z.boolean(),
    frequency: z.nativeEnum(BackupFrequency),
    retentionDays: z.number().int(),
    s3Endpoint: z.string().nullable(),
    region: z.string().nullable(),
    bucket: z.string().nullable(),
    keyIdConfigured: z.boolean(),
    appKeyConfigured: z.boolean(),
    lastRunAt: z.string().nullable(),
    lastRunStatus: z.string().nullable(),
  }),
  telegram: z.object({
    enabled: z.boolean(),
    linked: z.boolean(),
    botTokenConfigured: z.boolean(),
    chatId: z.string().nullable(),
    dailyDigest: z.boolean(),
    digestHour: z.number().int(),
    /** token de uso único para o usuário parear o chat no bot */
    linkToken: z.string().nullable(),
  }),
  notifications: z.object({
    billsDue: z.boolean(),
    invoiceClosing: z.boolean(),
    lowBalance: z.boolean(),
    weeklySummary: z.boolean(),
    pendingUsers: z.boolean(),
    lowBalanceThreshold: z.number().int(),
  }),
  appearance: z.object({
    themePref: z.enum(['system', 'light', 'dark']),
  }),
});
export type Settings = z.infer<typeof settingsSchema>;
