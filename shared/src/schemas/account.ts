import { z } from 'zod';
import { AccountType } from '../constants.js';

export const accountTypeSchema = z.nativeEnum(AccountType);

export const createAccountBodySchema = z.object({
  name: z.string().min(1, 'Informe um nome').max(80),
  type: accountTypeSchema,
  openingBalance: z.number().int().default(0), // centavos, pode ser negativo
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  icon: z.string().max(40).optional(),
  /** conta pré-selecionada nos formulários (só uma fica ativa por usuário) */
  isDefault: z.boolean().optional(),
  /** entra nos totais e gráficos do dashboard */
  includeInDashboard: z.boolean().optional(),
  archived: z.boolean().optional(),
});
export type CreateAccountBody = z.infer<typeof createAccountBodySchema>;

export const updateAccountBodySchema = createAccountBodySchema.partial();
export type UpdateAccountBody = z.infer<typeof updateAccountBodySchema>;

export const accountSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: accountTypeSchema,
  openingBalance: z.number().int(),
  color: z.string().nullable(),
  icon: z.string().nullable(),
  isDefault: z.boolean(),
  includeInDashboard: z.boolean(),
  archived: z.boolean(),
  createdAt: z.string(),
  // saldos calculados
  currentBalance: z.number().int(),
  projectedBalance: z.number().int(),
});
export type Account = z.infer<typeof accountSchema>;
