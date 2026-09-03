import { z } from 'zod';
import { isoDateSchema } from './common.js';

export const calendarQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Formato esperado: YYYY-MM'),
  userId: z.string().optional(), // admin
});
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

export const calendarDaySchema = z.object({
  date: isoDateSchema,
  incomePaid: z.number().int(),
  incomePending: z.number().int(),
  expensePaid: z.number().int(),
  expensePending: z.number().int(),
  count: z.number().int(),
});
export type CalendarDay = z.infer<typeof calendarDaySchema>;

export const calendarResponseSchema = z.object({
  month: z.string(),
  days: z.array(calendarDaySchema),
});
export type CalendarResponse = z.infer<typeof calendarResponseSchema>;
