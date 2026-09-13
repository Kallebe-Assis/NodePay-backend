import { z } from 'zod';
import { isoDateSchema } from './common.js';
import { flowListSchema, idListSchema } from './report.js';

/** Mesmos filtros de conta/cartão/grupo do "Gerar relatório", reaproveitados nos Gráficos. */
export const chartsQuerySchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  /** vazio/ausente = todas as contas */
  accountIds: idListSchema,
  /** vazio/ausente = todos os cartões */
  creditCardIds: idListSchema,
  /** vazio/ausente = todos os grupos (receitas, despesas, cartão, transferências) */
  flows: flowListSchema,
  userId: z.string().optional(), // admin
});
export type ChartsQuery = z.infer<typeof chartsQuerySchema>;

const catRow = z.object({
  categoryId: z.string().nullable(),
  name: z.string(),
  color: z.string().nullable(),
  total: z.number().int(),
});

export const chartsResponseSchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  totals: z.object({
    income: z.number().int(),
    expense: z.number().int(),
    net: z.number().int(),
  }),
  incomeExpenseByMonth: z.array(
    z.object({
      month: z.string(), // YYYY-MM
      income: z.number().int(),
      expense: z.number().int(),
      net: z.number().int(),
    }),
  ),
  expenseByCategory: z.array(catRow),
  incomeByCategory: z.array(catRow),
  balanceEvolution: z.array(z.object({ date: isoDateSchema, balance: z.number().int() })),
  topExpenses: z.array(z.object({ description: z.string(), total: z.number().int() })),
  statusSplit: z.object({
    paid: z.number().int(),
    pending: z.number().int(),
  }),
  fixedVsVariable: z.object({
    fixed: z.number().int(),
    variable: z.number().int(),
  }),
});
export type ChartsResponse = z.infer<typeof chartsResponseSchema>;
