import { z } from 'zod';

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(80),
  userId: z.string().optional(),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

const hit = z.object({
  id: z.string(),
  label: z.string(),
  sub: z.string().nullable(),
});

export const searchResponseSchema = z.object({
  transactions: z.array(hit),
  accounts: z.array(hit),
  cards: z.array(hit),
  categories: z.array(hit),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
