import { z } from 'zod';
import { centsSchema } from './common.js';

/** Cria/atualiza o teto mensal de uma categoria. */
export const budgetInputSchema = z.object({
  categoryId: z.string().min(1, 'Selecione a categoria'),
  amount: centsSchema, // teto mensal, centavos
  active: z.boolean().optional(),
});
export type BudgetInput = z.infer<typeof budgetInputSchema>;

/** Ajuste em lote — define/zera vários tetos de uma vez (tela "Orçamento"). */
export const budgetBulkInputSchema = z.object({
  items: z
    .array(
      z.object({
        categoryId: z.string().min(1),
        amount: z.number().int().min(0), // 0 = remover o orçamento
      }),
    )
    .max(200),
});
export type BudgetBulkInput = z.infer<typeof budgetBulkInputSchema>;

/** Uma linha de orçamento com o consumo do mês corrente. */
export const budgetSchema = z.object({
  id: z.string(),
  categoryId: z.string(),
  categoryName: z.string(),
  color: z.string().nullable(),
  amount: z.number().int(),
  /** gasto (PAGO + pendente) da categoria no mês de referência */
  spent: z.number().int(),
  remaining: z.number().int(),
  /** spent / amount, 0..(>1) */
  usage: z.number(),
  active: z.boolean(),
  month: z.string(), // YYYY-MM
});
export type Budget = z.infer<typeof budgetSchema>;

export const budgetListResponseSchema = z.object({
  month: z.string(),
  totalBudget: z.number().int(),
  totalSpent: z.number().int(),
  items: z.array(budgetSchema),
});
export type BudgetListResponse = z.infer<typeof budgetListResponseSchema>;
