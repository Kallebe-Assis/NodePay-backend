import { z } from 'zod';
import { isValidIsoDate } from '../date.js';

export const cuid = z.string().min(1);

/**
 * Boolean tolerante a string. `z.coerce.boolean()` transforma QUALQUER string
 * não-vazia em `true` (incl. "false"), o que quebra flags de .env e query.
 * Aceita: true/false, "true"/"false", "1"/"0", "yes"/"no", "" e undefined.
 */
export const booleanish = (defaultValue = false) =>
  z.preprocess((v) => {
    if (typeof v === 'boolean') return v;
    if (v === undefined || v === null || v === '') return defaultValue;
    const s = String(v).trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' || s === 'on';
  }, z.boolean());

export const isoDateSchema = z
  .string()
  .refine(isValidIsoDate, { message: 'Data deve estar no formato YYYY-MM-DD' });

/** Valor monetário em centavos: inteiro positivo. */
export const centsSchema = z
  .number()
  .int('Valor deve ser inteiro em centavos')
  .positive('Valor deve ser maior que zero')
  .max(Number.MAX_SAFE_INTEGER);

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * Filtro de escopo por dono. Só tem efeito para ADMIN — permite ver os dados de
 * um usuário específico (ou de todos, quando omitido). Para USER é ignorado.
 */
export const adminScopeQuerySchema = z.object({
  userId: z.string().optional(),
});
export type AdminScopeQuery = z.infer<typeof adminScopeQuerySchema>;

export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  });
}

/** Envelope de erro padrão da API. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** Intervalo de datas para filtros de relatório/dashboard. */
export const dateRangeSchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
});
export type DateRange = z.infer<typeof dateRangeSchema>;
