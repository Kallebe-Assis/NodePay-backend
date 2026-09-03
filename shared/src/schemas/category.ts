import { z } from 'zod';
import { CategoryKind } from '../constants.js';

export const categoryKindSchema = z.nativeEnum(CategoryKind);

export const createCategoryBodySchema = z.object({
  name: z.string().min(1).max(60),
  kind: categoryKindSchema,
  parentId: z.string().nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  icon: z.string().max(40).optional(),
});
export type CreateCategoryBody = z.infer<typeof createCategoryBodySchema>;

export const updateCategoryBodySchema = createCategoryBodySchema.partial();
export type UpdateCategoryBody = z.infer<typeof updateCategoryBodySchema>;

export const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: categoryKindSchema,
  parentId: z.string().nullable(),
  color: z.string().nullable(),
  icon: z.string().nullable(),
  createdAt: z.string(),
  childCount: z.number().int().optional(),
  transactionCount: z.number().int().optional(),
});
export type Category = z.infer<typeof categorySchema>;

/** Subcategoria = categoria com parentId. Alias semântico para o front. */
export type Subcategory = Category & { parentId: string };
