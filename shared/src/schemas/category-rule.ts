import { z } from 'zod';

/** Cria/atualiza uma regra de auto-categorização. */
export const categoryRuleInputSchema = z.object({
  match: z.string().min(2, 'Informe pelo menos 2 caracteres').max(80),
  categoryId: z.string().min(1, 'Selecione a categoria'),
  priority: z.number().int().min(0).max(100).optional(),
  active: z.boolean().optional(),
});
export type CategoryRuleInput = z.infer<typeof categoryRuleInputSchema>;

export const categoryRuleSchema = z.object({
  id: z.string(),
  match: z.string(),
  categoryId: z.string(),
  categoryName: z.string(),
  color: z.string().nullable(),
  priority: z.number().int(),
  active: z.boolean(),
});
export type CategoryRule = z.infer<typeof categoryRuleSchema>;

/** `GET /category-rules/match?description=...` → categoria sugerida (ou null). */
export const categoryRuleMatchQuerySchema = z.object({
  description: z.string().min(1).max(160),
});
export const categoryRuleMatchResponseSchema = z.object({
  categoryId: z.string().nullable(),
  ruleId: z.string().nullable(),
});
export type CategoryRuleMatchResponse = z.infer<typeof categoryRuleMatchResponseSchema>;
