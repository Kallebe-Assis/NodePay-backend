import { z } from 'zod';
import { isoDateSchema } from './common.js';

export const dashboardQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Formato esperado: YYYY-MM')
    .optional(),
  /** admin: ver o dashboard de um usuário específico */
  userId: z.string().optional(),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export const categoryBreakdownRowSchema = z.object({
  categoryId: z.string().nullable(),
  categoryName: z.string(),
  color: z.string().nullable(),
  total: z.number().int(),
  share: z.number(), // 0..1
});

export const cashflowPointSchema = z.object({
  date: isoDateSchema,
  income: z.number().int(),
  expense: z.number().int(),
  net: z.number().int(),
  projectedBalance: z.number().int(),
});

export const creditSummarySchema = z.object({
  limitTotal: z.number().int(),
  openInvoicesTotal: z.number().int(),
  available: z.number().int(),
  usageRatio: z.number(), // 0..1
  nextDueDate: z.string().nullable(),
  nextDueAmount: z.number().int(),
});

export const dashboardSummarySchema = z.object({
  month: z.string(),
  /** somam apenas lançamentos LIQUIDADOS (status = PAID) no mês */
  totalIncome: z.number().int(),
  totalExpense: z.number().int(),
  net: z.number().int(),
  /** pendentes/agendados do mês (não entram no total nem no net) */
  pendingIncome: z.number().int(),
  pendingExpense: z.number().int(),
  currentBalance: z.number().int(),
  projectedEndOfMonthBalance: z.number().int(),
  upcomingBills: z.number().int(),
  openInvoicesTotal: z.number().int(),
  loanOutstanding: z.number().int(),
  /** % da renda do mês já comprometida com fixos + parcelas + empréstimos. */
  incomeCommitmentRatio: z.number(),
  categoryBreakdown: z.array(categoryBreakdownRowSchema),
  incomeCategoryBreakdown: z.array(categoryBreakdownRowSchema),
  credit: creditSummarySchema,
  cashflow: z.array(cashflowPointSchema),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
