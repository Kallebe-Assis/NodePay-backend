import { z } from 'zod';
import {
  RecurrenceFrequency,
  RecurrenceMode,
  TransactionStatus,
  TransactionType,
} from '../constants.js';
import { centsSchema, isoDateSchema, paginationQuerySchema } from './common.js';

export const transactionTypeSchema = z.nativeEnum(TransactionType);
export const transactionStatusSchema = z.nativeEnum(TransactionStatus);
export const recurrenceModeSchema = z.nativeEnum(RecurrenceMode);
export const recurrenceFrequencySchema = z.nativeEnum(RecurrenceFrequency);

/**
 * Bloco de recorrência da Tela 1 ("Esta despesa se repete?").
 *  - none: lançamento único
 *  - installment: parcelado em N vezes (gera N lançamentos)
 *  - fixed: repete todo período, sem data fim
 */
export const recurrenceInputSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }),
  z.object({
    mode: z.literal(RecurrenceMode.INSTALLMENT),
    installments: z.number().int().min(2).max(360),
  }),
  z.object({
    mode: z.literal(RecurrenceMode.FIXED),
    frequency: recurrenceFrequencySchema.default(RecurrenceFrequency.MONTHLY),
  }),
]);
export type RecurrenceInput = z.infer<typeof recurrenceInputSchema>;

/** ---- Tela 1: lançamento em conta (despesa OU receita) ---- */
export const accountEntryBodySchema = z.object({
  kind: z.literal('account'),
  direction: z.enum(['expense', 'income']),
  amount: centsSchema,
  description: z.string().min(1, 'Informe uma descrição').max(160),
  date: isoDateSchema, // data de competência
  accountId: z.string().min(1, 'Selecione a conta'),
  categoryId: z.string().min(1, 'Selecione a categoria'),
  paid: z.boolean(), // toggle PAGO / PENDENTE
  recurrence: recurrenceInputSchema.default({ mode: 'none' }),
  /** lembrete no Telegram X dias antes do vencimento */
  remindTelegram: z.boolean().default(false),
  remindDaysBefore: z.number().int().min(0).max(30).default(1),
});
export type AccountEntryBody = z.infer<typeof accountEntryBodySchema>;

/** ---- Tela 2: compra no cartão de crédito ---- */
export const cardEntryBodySchema = z.object({
  kind: z.literal('card'),
  amount: centsSchema, // valor TOTAL da compra
  description: z.string().min(1, 'Informe uma descrição').max(160),
  purchaseDate: isoDateSchema,
  creditCardId: z.string().min(1, 'Selecione o cartão'),
  categoryId: z.string().min(1, 'Selecione a categoria'),
  installments: z.number().int().min(1).max(60).default(1),
});
export type CardEntryBody = z.infer<typeof cardEntryBodySchema>;

/** ---- Transferência entre contas ---- */
export const transferBodySchema = z.object({
  kind: z.literal('transfer'),
  amount: centsSchema,
  description: z.string().max(160).default('Transferência'),
  date: isoDateSchema,
  fromAccountId: z.string().min(1),
  toAccountId: z.string().min(1),
  paid: z.boolean().default(true),
});
export type TransferBody = z.infer<typeof transferBodySchema>;

export const createTransactionBodySchema = z.discriminatedUnion('kind', [
  accountEntryBodySchema,
  cardEntryBodySchema,
  transferBodySchema,
]);
export type CreateTransactionBody = z.infer<typeof createTransactionBodySchema>;

/** Edição pontual de um lançamento já existente. */
export const updateTransactionBodySchema = z.object({
  description: z.string().min(1).max(160).optional(),
  amount: centsSchema.optional(),
  date: isoDateSchema.optional(),
  categoryId: z.string().optional(),
  accountId: z.string().optional(),
  status: transactionStatusSchema.optional(),
  paidDate: isoDateSchema.nullable().optional(),
  /** Ao editar um item de uma série: alcance da alteração. */
  scope: z.enum(['one', 'forward', 'all']).default('one'),
});
export type UpdateTransactionBody = z.infer<typeof updateTransactionBodySchema>;

export const markPaidBodySchema = z.object({
  paidDate: isoDateSchema,
  accountId: z.string().optional(), // se quiser liquidar por outra conta
});
export type MarkPaidBody = z.infer<typeof markPaidBodySchema>;

export const listTransactionsQuerySchema = paginationQuerySchema.extend({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  accountId: z.string().optional(),
  creditCardId: z.string().optional(),
  /** categoria: se for uma categoria-pai, inclui as subcategorias dela */
  categoryId: z.string().optional(),
  /** subcategoria específica (tem prioridade sobre categoryId) */
  subcategoryId: z.string().optional(),
  type: transactionTypeSchema.optional(),
  status: transactionStatusSchema.optional(),
  /** filtro de sentido: todos / despesas / receitas */
  flow: z.enum(['all', 'expense', 'income']).optional(),
  minAmount: z.coerce.number().int().nonnegative().optional(), // centavos
  maxAmount: z.coerce.number().int().nonnegative().optional(),
  search: z.string().max(120).optional(),
  /** admin: filtrar por dono (ignorado para usuários comuns) */
  userId: z.string().optional(),
});
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;

export const transactionSchema = z.object({
  id: z.string(),
  type: transactionTypeSchema,
  status: transactionStatusSchema,
  amount: z.number().int(),
  description: z.string(),
  competenceDate: isoDateSchema,
  dueDate: isoDateSchema,
  paidDate: isoDateSchema.nullable(),
  accountId: z.string().nullable(),
  creditCardId: z.string().nullable(),
  invoiceId: z.string().nullable(),
  categoryId: z.string().nullable(),
  recurrenceId: z.string().nullable(),
  installmentGroupId: z.string().nullable(),
  installmentNumber: z.number().int().nullable(),
  installmentTotal: z.number().int().nullable(),
  loanId: z.string().nullable(),
  transferGroupId: z.string().nullable(),
  transferToAccountId: z.string().nullable(),
  remindTelegram: z.boolean(),
  remindDaysBefore: z.number().int(),
  createdAt: z.string(),
});
export type Transaction = z.infer<typeof transactionSchema>;

/** Preview do "RESUMO DO GASTO" (calculado no front, sem persistir). */
export interface InstallmentPreviewRow {
  number: number;
  total: number;
  amount: number; // centavos
  date: string; // YYYY-MM-DD
}

/* ---------------------------------------------------------------------------
 * Importação em massa de lançamentos por CSV (limite: 50 por importação)
 * ------------------------------------------------------------------------- */
export const IMPORT_MAX_ROWS = 50;

/** Cabeçalhos do modelo CSV (nesta ordem). */
export const IMPORT_CSV_HEADERS = [
  'data',
  'tipo',
  'descricao',
  'valor',
  'conta',
  'categoria',
  'pago',
] as const;

/** Uma linha já analisada e validada pelo servidor. */
export const importRowSchema = z.object({
  line: z.number().int(),
  ok: z.boolean(),
  error: z.string().nullable(),
  /** valores normalizados (quando `ok`) */
  date: z.string(),
  direction: z.enum(['expense', 'income']),
  description: z.string(),
  amount: z.number().int(), // centavos
  accountName: z.string(),
  categoryName: z.string().nullable(),
  paid: z.boolean(),
});
export type ImportRow = z.infer<typeof importRowSchema>;

export const importPreviewBodySchema = z.object({ csv: z.string().min(1).max(200_000) });
export type ImportPreviewBody = z.infer<typeof importPreviewBodySchema>;

export const importPreviewResponseSchema = z.object({
  rows: z.array(importRowSchema),
  total: z.number().int(),
  valid: z.number().int(),
  invalid: z.number().int(),
});
export type ImportPreviewResponse = z.infer<typeof importPreviewResponseSchema>;

export const importCommitResponseSchema = z.object({ created: z.number().int() });
export type ImportCommitResponse = z.infer<typeof importCommitResponseSchema>;

/** Liquidar vários lançamentos de uma vez (tela de Lançamentos). */
export const bulkPayBodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  paidDate: isoDateSchema,
});
export type BulkPayBody = z.infer<typeof bulkPayBodySchema>;

export const bulkPayResponseSchema = z.object({ paid: z.number().int() });
export type BulkPayResponse = z.infer<typeof bulkPayResponseSchema>;
