import { z } from 'zod';
import { InvoiceStatus } from '../constants.js';
import { isoDateSchema } from './common.js';

const dayOfMonth = z.number().int().min(1).max(31);

export const createCreditCardBodySchema = z.object({
  name: z.string().min(1).max(80),
  lastDigits: z
    .string()
    .regex(/^\d{4}$/, 'Informe os 4 últimos dígitos')
    .optional(),
  brand: z.string().max(40).optional(),
  /** id do banco (ver BANKS em constants) */
  bankId: z.string().max(40).optional(),
  creditLimit: z.number().int().nonnegative().default(0), // centavos
  closingDay: dayOfMonth,
  dueDay: dayOfMonth,
  defaultPaymentAccountId: z.string().nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  archived: z.boolean().optional(),
});
export type CreateCreditCardBody = z.infer<typeof createCreditCardBodySchema>;

export const updateCreditCardBodySchema = createCreditCardBodySchema.partial();
export type UpdateCreditCardBody = z.infer<typeof updateCreditCardBodySchema>;

export const creditCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  lastDigits: z.string().nullable(),
  brand: z.string().nullable(),
  bankId: z.string().nullable(),
  creditLimit: z.number().int(),
  closingDay: z.number().int(),
  dueDay: z.number().int(),
  defaultPaymentAccountId: z.string().nullable(),
  color: z.string().nullable(),
  archived: z.boolean(),
  createdAt: z.string(),
  // calculado
  /** soma de TODAS as faturas em aberto/fechadas (gasto acumulado no cartão) */
  openInvoiceTotal: z.number().int(),
  /** total da PRÓXIMA fatura a vencer (a que o usuário vai pagar primeiro) */
  nextInvoiceTotal: z.number().int(),
  /** vencimento dessa próxima fatura (YYYY-MM-DD) — null se não há fatura */
  nextInvoiceDueDate: isoDateSchema.nullable(),
  availableLimit: z.number().int(),
});
export type CreditCard = z.infer<typeof creditCardSchema>;

export const invoiceStatusSchema = z.nativeEnum(InvoiceStatus);

export const invoiceSchema = z.object({
  id: z.string(),
  creditCardId: z.string(),
  referenceMonth: isoDateSchema,
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  closingDate: isoDateSchema,
  dueDate: isoDateSchema,
  status: invoiceStatusSchema,
  total: z.number().int(),
  paidTransactionId: z.string().nullable(),
});
export type Invoice = z.infer<typeof invoiceSchema>;

export const payInvoiceBodySchema = z.object({
  accountId: z.string().min(1),
  paidDate: isoDateSchema,
  amount: z.number().int().positive().optional(), // default: total da fatura
});
export type PayInvoiceBody = z.infer<typeof payInvoiceBodySchema>;
