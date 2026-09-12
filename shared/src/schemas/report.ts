import { z } from 'zod';
import { isoDateSchema } from './common.js';

/** Formato do arquivo gerado. */
export const reportFormatSchema = z.enum(['csv', 'pdf']);
export type ReportFormat = z.infer<typeof reportFormatSchema>;

/** Tipo de relatório. */
export const reportKindSchema = z.enum([
  'statement', // extrato de lançamentos
  'monthly', // fechamento do mês
  'by-category', // gasto por categoria
  'invoices', // faturas de cartão
  'loans', // posição de empréstimos
]);
export type ReportKind = z.infer<typeof reportKindSchema>;

/** Grandes grupos de lançamento que o relatório pode incluir/excluir. */
export const reportFlowSchema = z.enum(['income', 'expense', 'card', 'transfer']);
export type ReportFlow = z.infer<typeof reportFlowSchema>;

/** Aceita array (JSON, POST) ou lista separada por vírgula (querystring, GET). */
const idListSchema = z
  .union([z.array(z.string()), z.string()])
  .transform((v) => (Array.isArray(v) ? v : v.split(',').filter(Boolean)))
  .optional();

const flowListSchema = z
  .union([z.array(reportFlowSchema), z.string()])
  .transform((v) => (Array.isArray(v) ? v : v.split(',').filter(Boolean)) as ReportFlow[])
  .optional();

/**
 * Seleção de um relatório: o que gerar, em que formato e sobre qual recorte de
 * dados. É compartilhada pelo download (`GET /reports/generate`) e pelo envio
 * por Telegram (`POST /reports/telegram`).
 */
export const reportSelectionSchema = z.object({
  kind: reportKindSchema,
  format: reportFormatSchema,
  from: isoDateSchema,
  to: isoDateSchema,
  /** vazio/ausente = todas as contas */
  accountIds: idListSchema,
  /** vazio/ausente = todos os cartões */
  creditCardIds: idListSchema,
  categoryId: z.string().optional(),
  /** vazio/ausente = todos os grupos (receitas, despesas, cartão, transferências) */
  flows: flowListSchema,
  /** admin: gerar o relatório de outro usuário */
  userId: z.string().optional(),
});

/** Querystring de `GET /reports/generate` (baixa o arquivo). */
export const generateReportQuerySchema = reportSelectionSchema;
export type GenerateReportQuery = z.infer<typeof generateReportQuerySchema>;

/** Body de `POST /reports/telegram` (gera e envia pelo bot). */
export const deliverReportBodySchema = reportSelectionSchema;
export type DeliverReportBody = z.infer<typeof deliverReportBodySchema>;

/** Resposta de `POST /reports/telegram`. */
export const deliverReportResponseSchema = z.object({
  delivered: z.literal(true),
  filename: z.string(),
});
export type DeliverReportResponse = z.infer<typeof deliverReportResponseSchema>;
