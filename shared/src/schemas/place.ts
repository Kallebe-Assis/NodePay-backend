import { z } from 'zod';

/** Local de compra (mercado, loja, shopping…). Só o nome é obrigatório. */
export const createPlaceBodySchema = z.object({
  name: z.string().min(1, 'Informe uma descrição').max(80),
  /** link de imagem para usar como logo (alternativa ao ícone) */
  logoUrl: z.string().url().max(500).optional().or(z.literal('')),
  /** nome de ícone (mesmo catálogo das categorias) — alternativa ao logo */
  icon: z.string().max(40).optional(),
  address: z.string().max(160).optional(),
  city: z.string().max(80).optional(),
  state: z.string().max(2).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  archived: z.boolean().optional(),
});
export type CreatePlaceBody = z.infer<typeof createPlaceBodySchema>;

export const updatePlaceBodySchema = createPlaceBodySchema.partial();
export type UpdatePlaceBody = z.infer<typeof updatePlaceBodySchema>;

export const placeSchema = z.object({
  id: z.string(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  icon: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  color: z.string().nullable(),
  archived: z.boolean(),
  createdAt: z.string(),
  /** gasto no mês pedido (ou o corrente); presente só quando `?month=` listado */
  spentThisMonth: z.number().int().optional(),
  transactionCount: z.number().int().optional(),
});
export type Place = z.infer<typeof placeSchema>;

export const listPlacesQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  includeArchived: z.coerce.boolean().optional(),
  userId: z.string().optional(),
});
export type ListPlacesQuery = z.infer<typeof listPlacesQuerySchema>;
