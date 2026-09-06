import { z } from 'zod';
import { AccountType } from '../constants.js';
import { isoDateSchema } from './common.js';

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
  /** id do banco (paleta BANKS) para exibir a logo */
  bankId: z.string().max(40).optional(),
  /** conta pré-selecionada nos formulários (só uma fica ativa por usuário) */
  isDefault: z.boolean().optional(),
  /** entra nos totais e gráficos do dashboard */
  includeInDashboard: z.boolean().optional(),
  archived: z.boolean().optional(),
});
export type CreateAccountBody = z.infer<typeof createAccountBodySchema>;

export const updateAccountBodySchema = createAccountBodySchema.partial();
export type UpdateAccountBody = z.infer<typeof updateAccountBodySchema>;

/**
 * Conciliação: informa o saldo REAL da conta (o que o banco mostra) e a API
 * ajusta a diferença de uma de duas formas (ver `mode`).
 */
export const reconcileAccountBodySchema = z.object({
  targetBalance: z.number().int(), // saldo desejado, centavos (pode ser negativo)
  date: isoDateSchema.optional(), // data do ajuste; padrão = hoje
  note: z.string().max(120).optional(),
  /**
   *  - 'adjustment' (padrão): cria um lançamento AJUSTE (receita/despesa) já
   *    liquidado com a diferença, mantendo o histórico.
   *  - 'opening': altera o saldo inicial da conta na diferença exata, sem
   *    gerar lançamento.
   * O alvo é sempre o SALDO ATUAL (liquidado) da conta. Padrão: 'adjustment'.
   */
  mode: z.enum(['adjustment', 'opening']).optional(),
});
export type ReconcileAccountBody = z.infer<typeof reconcileAccountBodySchema>;

export const reconcileAccountResponseSchema = z.object({
  adjusted: z.boolean(), // false = já estava batido
  delta: z.number().int(),
  mode: z.enum(['adjustment', 'opening']),
  transactionId: z.string().nullable(), // preenchido só no mode 'adjustment'
  openingBalance: z.number().int().nullable(), // novo saldo inicial no mode 'opening'
});
export type ReconcileAccountResponse = z.infer<typeof reconcileAccountResponseSchema>;

export const accountSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: accountTypeSchema,
  openingBalance: z.number().int(),
  color: z.string().nullable(),
  icon: z.string().nullable(),
  bankId: z.string().nullable(),
  isDefault: z.boolean(),
  includeInDashboard: z.boolean(),
  archived: z.boolean(),
  createdAt: z.string(),
  // saldos calculados
  currentBalance: z.number().int(),
  projectedBalance: z.number().int(),
});
export type Account = z.infer<typeof accountSchema>;
