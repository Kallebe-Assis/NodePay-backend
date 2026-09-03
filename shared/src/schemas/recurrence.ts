import { z } from 'zod';
import { isoDateSchema } from './common.js';
import { recurrenceFrequencySchema, recurrenceModeSchema } from './transaction.js';

/** Uma série recorrente (regra que materializa lançamentos). */
export const recurrenceSchema = z.object({
  id: z.string(),
  mode: recurrenceModeSchema,
  frequency: recurrenceFrequencySchema,
  interval: z.number().int(),
  direction: z.enum(['expense', 'income']),
  amount: z.number().int(),
  description: z.string(),
  accountId: z.string().nullable(),
  categoryId: z.string().nullable(),
  startDate: isoDateSchema,
  endDate: isoDateSchema.nullable(),
  occurrences: z.number().int().nullable(),
  materializedUntil: isoDateSchema.nullable(),
  active: z.boolean(),
  /** quantos lançamentos ainda por vir (status != PAID/CANCELED) */
  upcomingCount: z.number().int(),
});
export type Recurrence = z.infer<typeof recurrenceSchema>;

/** Pausar/retomar ou encerrar numa data. */
export const updateRecurrenceBodySchema = z.object({
  active: z.boolean().optional(),
  endDate: isoDateSchema.nullable().optional(),
});
export type UpdateRecurrenceBody = z.infer<typeof updateRecurrenceBodySchema>;
