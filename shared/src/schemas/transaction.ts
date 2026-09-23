import { z } from 'zod';
import {
  PaymentMethod,
  RecurrenceFrequency,
  RecurrenceMode,
  TransactionStatus,
  TransactionType,
  TransferFlow,
} from '../constants.js';
import { centsSchema, isoDateSchema, paginationQuerySchema } from './common.js';

export const transactionTypeSchema = z.nativeEnum(TransactionType);
export const transactionStatusSchema = z.nativeEnum(TransactionStatus);
export const recurrenceModeSchema = z.nativeEnum(RecurrenceMode);
export const recurrenceFrequencySchema = z.nativeEnum(RecurrenceFrequency);
export const transferFlowSchema = z.nativeEnum(TransferFlow);
export const paymentMethodSchema = z.nativeEnum(PaymentMethod);

/** Detalhes de pagamento opcionais de uma despesa — "opções avançadas" do formulário. */
const paymentDetailsExtras = {
  /** vencimento (prazo limite) — ausente = usa a data de pagamento, ou a competência */
  dueDate: isoDateSchema.optional(),
  payeeName: z.string().max(160).optional(),
  paymentMethod: paymentMethodSchema.optional(),
  boletoLine: z.string().max(200).optional(),
  pixCopyPaste: z.string().max(700).optional(),
};

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
    /**
     * Pra registrar uma dívida que já tinha parcelas pagas ANTES de existir no
     * NodePay: só lança a partir desta (as anteriores não são criadas). `date`
     * continua sendo a data da parcela 1 (a original), não a de hoje.
     */
    startInstallment: z.number().int().min(1).optional(),
  }),
  z.object({
    mode: z.literal(RecurrenceMode.FIXED),
    frequency: recurrenceFrequencySchema.default(RecurrenceFrequency.MONTHLY),
    /**
     * Quantas ocorrências lançar agora. Sem isso, materializa continuamente
     * (~12 meses / ~52 semanas à frente, estendido pelo job diário).
     */
    occurrences: z.number().int().min(1).max(360).optional(),
  }),
]);
export type RecurrenceInput = z.infer<typeof recurrenceInputSchema>;

/** Etiqueta livre (lançamento). Curta, sem obrigar formato. */
export const tagSchema = z.string().trim().min(1).max(24);
/** Observação livre (lançamento). */
export const notesSchema = z.string().max(500);

/** Campos opcionais comuns a qualquer lançamento (conta ou cartão). */
const optionalExtras = {
  notes: notesSchema.optional(),
  tags: z.array(tagSchema).max(10).optional(),
  /** local de compra (opcional) — ver /places */
  placeId: z.string().optional(),
  /** soma nos totais/dashboard? default true — desligar não afeta o saldo da conta. */
  includeInTotals: z.boolean().default(true),
};

/** ---- Tela 1: lançamento em conta (despesa OU receita) ---- */
export const accountEntryBodySchema = z.object({
  kind: z.literal('account'),
  direction: z.enum(['expense', 'income']),
  amount: centsSchema,
  description: z.string().min(1, 'Informe uma descrição').max(160),
  date: isoDateSchema, // data de competência (data do lançamento)
  /**
   * Data do pagamento. Se `paid`, é a data em que liquidou; se pendente, é a
   * data de pagamento planejada. Ausente => usa `dueDate` ?? `date`.
   */
  paymentDate: isoDateSchema.optional(),
  accountId: z.string().min(1, 'Selecione a conta'),
  /** opcional — lançamento sem categoria fica em "Sem categoria" */
  categoryId: z.string().optional(),
  paid: z.boolean(), // toggle PAGO / PENDENTE
  recurrence: recurrenceInputSchema.default({ mode: 'none' }),
  ...paymentDetailsExtras,
  /** lembrete no Telegram X dias antes do vencimento */
  remindTelegram: z.boolean().default(false),
  remindDaysBefore: z.number().int().min(0).max(30).default(1),
  ...optionalExtras,
});
export type AccountEntryBody = z.infer<typeof accountEntryBodySchema>;

/**
 * Compra recorrente no cartão: repete todo mês ou toda semana (uma parcela por
 * ocorrência, cada uma na fatura certa). Não combina com parcelamento.
 */
export const cardRecurrenceInputSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }),
  z.object({
    mode: z.literal(RecurrenceMode.FIXED),
    frequency: z.enum([RecurrenceFrequency.MONTHLY, RecurrenceFrequency.WEEKLY]).default('MONTHLY'),
    /** quantas ocorrências lançar agora; sem isso, ~12 meses / ~52 semanas à frente */
    occurrences: z.number().int().min(1).max(360).optional(),
  }),
]);

/** ---- Tela 2: compra no cartão de crédito ---- */
export const cardEntryBodySchema = z.object({
  kind: z.literal('card'),
  amount: centsSchema, // valor TOTAL da compra
  description: z.string().min(1, 'Informe uma descrição').max(160),
  purchaseDate: isoDateSchema,
  creditCardId: z.string().min(1, 'Selecione o cartão'),
  /** opcional — lançamento sem categoria fica em "Sem categoria" */
  categoryId: z.string().optional(),
  installments: z.number().int().min(1).max(60).default(1),
  /**
   * Como interpretar `amount` quando há 2+ parcelas:
   *  - false (padrão): `amount` é o TOTAL da compra, dividido entre as parcelas
   *  - true: `amount` é o valor de CADA parcela (total = amount × installments)
   */
  amountIsPerInstallment: z.boolean().optional(),
  /** Igual ao de `recurrenceInputSchema` — pra registrar um parcelamento no cartão já em andamento. */
  startInstallment: z.number().int().min(1).optional(),
  /** fixo mensal/semanal (só com `installments` = 1) */
  recurrence: cardRecurrenceInputSchema.default({ mode: 'none' }),
  ...optionalExtras,
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
  /** opcional — ex.: categorizar como "Poupança" */
  categoryId: z.string().optional(),
  /**
   * Por padrão uma transferência é neutra (não soma nos totais). Preencher
   * conta o valor como receita/despesa também — ex.: dinheiro indo pra uma
   * conta-reserva que o usuário quer ver como saída no dashboard.
   */
  transferFlow: transferFlowSchema.nullable().optional(),
  includeInTotals: z.boolean().default(true),
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
  date: isoDateSchema.optional(), // competência (data do lançamento)
  /** data de pagamento planejada (vencimento) — usada quando ainda não pago */
  dueDate: isoDateSchema.optional(),
  /** string vazia = remover a categoria */
  categoryId: z.string().optional(),
  accountId: z.string().optional(),
  /** só faz efeito num lançamento type=TRANSFER — a ponta de destino */
  transferToAccountId: z.string().optional(),
  status: transactionStatusSchema.optional(),
  paidDate: isoDateSchema.nullable().optional(),
  /** quanto já foi pago (centavos, 0+) — em conjunto com status PARTIAL */
  paidAmount: z.number().int().nonnegative().optional(),
  notes: notesSchema.nullable().optional(),
  tags: z.array(tagSchema).max(10).optional(),
  /** string vazia = remover o local de compra */
  placeId: z.string().optional(),
  /** soma nos totais/dashboard? (não afeta o saldo da conta) */
  includeInTotals: z.boolean().optional(),
  /** só faz efeito num lançamento type=TRANSFER — ver transferBodySchema */
  transferFlow: transferFlowSchema.nullable().optional(),
  /** string vazia = remover */
  payeeName: z.string().max(160).optional(),
  paymentMethod: paymentMethodSchema.nullable().optional(),
  boletoLine: z.string().max(200).optional(),
  pixCopyPaste: z.string().max(700).optional(),
  /** Ao editar um item de uma série: alcance da alteração. */
  scope: z.enum(['one', 'forward', 'all']).default('one'),
  /**
   * Só relevante quando `date` muda numa parcela (avulsa ou de cartão):
   *  - true: remaneja a data de TODAS as parcelas do grupo, preservando o
   *    espaçamento mensal a partir da nova data desta.
   *  - false/ausente: só esta parcela muda (no cartão, migra para a fatura
   *    certa; as demais continuam onde estavam).
   */
  applyToInstallments: z.boolean().optional(),
});
export type UpdateTransactionBody = z.infer<typeof updateTransactionBodySchema>;

export const markPaidBodySchema = z.object({
  paidDate: isoDateSchema,
  accountId: z.string().optional(), // se quiser liquidar por outra conta
  /**
   * Pagamento parcial: valor pago agora (centavos). Se ausente ou >= saldo
   * devedor, quita o lançamento (status PAID). Caso contrário, soma em
   * `paidAmount` e o status vira PARTIAL.
   */
  amount: centsSchema.optional(),
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
  placeId: z.string().optional(),
  tag: z.string().optional(),
  type: transactionTypeSchema.optional(),
  status: transactionStatusSchema.optional(),
  /** vários status de uma vez, separados por vírgula (ex.: "PENDING,PARTIAL"); tem prioridade sobre `status` */
  statuses: z.string().max(120).optional(),
  /** filtro rápido: todos / despesas / receitas / compras no cartão */
  flow: z.enum(['all', 'expense', 'income', 'card']).optional(),
  minAmount: z.coerce.number().int().nonnegative().optional(), // centavos
  maxAmount: z.coerce.number().int().nonnegative().optional(),
  search: z.string().max(120).optional(),
  /** admin: filtrar por dono (ignorado para usuários comuns) */
  userId: z.string().optional(),
  /** ordenação da lista */
  sortBy: z
    .enum([
      'createdAt',
      'competenceDate',
      'dueDate',
      'paidDate',
      'amount',
      'description',
      'status',
      'account',
      'category',
    ])
    .default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;

/** Totais do conjunto filtrado (não só a página) — rodapé da tela de Lançamentos. */
export const transactionListTotalsSchema = z.object({
  count: z.number().int(),
  incomeCount: z.number().int(),
  expenseCount: z.number().int(),
  income: z.number().int(), // soma das receitas (centavos)
  expense: z.number().int(), // soma das despesas (centavos)
  net: z.number().int(), // income - expense
  /** resultado líquido (receitas − despesas) já liquidado */
  paid: z.number().int(),
  /** resultado líquido ainda pendente (inclui a parte não paga do PARCIAL) */
  pending: z.number().int(),
  /** resultado líquido agendado para o futuro */
  scheduled: z.number().int(),
});
export type TransactionListTotals = z.infer<typeof transactionListTotalsSchema>;

export const transactionSchema = z.object({
  id: z.string(),
  type: transactionTypeSchema,
  status: transactionStatusSchema,
  amount: z.number().int(),
  /** quanto já foi liquidado (centavos). 0, salvo em status PARTIAL/PAID */
  paidAmount: z.number().int(),
  description: z.string(),
  competenceDate: isoDateSchema,
  dueDate: isoDateSchema,
  paidDate: isoDateSchema.nullable(),
  accountId: z.string().nullable(),
  creditCardId: z.string().nullable(),
  invoiceId: z.string().nullable(),
  categoryId: z.string().nullable(),
  notes: z.string().nullable(),
  tags: z.array(z.string()),
  placeId: z.string().nullable(),
  recurrenceId: z.string().nullable(),
  installmentGroupId: z.string().nullable(),
  installmentNumber: z.number().int().nullable(),
  installmentTotal: z.number().int().nullable(),
  loanId: z.string().nullable(),
  transferGroupId: z.string().nullable(),
  transferToAccountId: z.string().nullable(),
  transferFlow: transferFlowSchema.nullable(),
  includeInTotals: z.boolean(),
  payeeName: z.string().nullable(),
  paymentMethod: paymentMethodSchema.nullable(),
  boletoLine: z.string().nullable(),
  pixCopyPaste: z.string().nullable(),
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

/** Cabeçalhos do modelo CSV (nesta ordem) — só `data`..`pago` são obrigatórias. */
export const IMPORT_CSV_HEADERS = [
  'data',
  'tipo',
  'descricao',
  'valor',
  'conta',
  'categoria',
  'pago',
  'data_pagamento',
  'local',
  'etiquetas',
  'observacoes',
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
  /** data de pagamento (efetiva se pago, prevista se pendente) — ausente = usa `date` */
  paymentDate: z.string(),
  placeName: z.string().nullable(),
  tags: z.array(z.string()),
  notes: z.string().nullable(),
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
