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

/** Variação vs. mês anterior (mesmos critérios de PAGO no mês). */
export const monthDeltaSchema = z.object({
  income: z.number().int(),
  expense: z.number().int(),
  /** fração de variação (atual-anterior)/|anterior|; null quando anterior = 0 */
  incomePct: z.number().nullable(),
  expensePct: z.number().nullable(),
});

/** Indicadores de saúde financeira do mês (só apresentação, sem query extra). */
export const financialHealthSchema = z.object({
  /** poupança do mês / receita do mês (0..1, pode ser negativo) */
  savingsRate: z.number(),
  /** % da renda comprometida com fixos + parcelas + empréstimos */
  commitmentRatio: z.number(),
  /** meses de reserva = saldo atual / gasto médio mensal; null se gasto = 0 */
  runwayMonths: z.number().nullable(),
});

export const netWorthPointSchema = z.object({
  month: z.string(), // YYYY-MM
  total: z.number().int(), // saldo consolidado ao fim do mês
});
export const netWorthResponseSchema = z.object({
  points: z.array(netWorthPointSchema),
});
export type NetWorthResponse = z.infer<typeof netWorthResponseSchema>;

export const netWorthQuerySchema = z.object({
  months: z.coerce.number().int().min(2).max(36).default(12),
  userId: z.string().optional(),
});

export const dashboardSummarySchema = z.object({
  month: z.string(),
  /** somam apenas lançamentos LIQUIDADOS (status = PAID) no mês */
  totalIncome: z.number().int(),
  totalExpense: z.number().int(),
  net: z.number().int(),
  prevMonth: monthDeltaSchema,
  health: financialHealthSchema,
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
