import { z } from 'zod';
import { GoalRecurrence, GoalType } from '../constants.js';
import { centsSchema } from './common.js';

export const goalTypeSchema = z.nativeEnum(GoalType);
export const goalRecurrenceSchema = z.nativeEnum(GoalRecurrence);

const monthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'Formato esperado: YYYY-MM');

export const createGoalBodySchema = z
  .object({
    title: z.string().min(1, 'Dê um nome ao objetivo').max(120),
    type: goalTypeSchema,
    targetAmount: centsSchema,
    recurrence: goalRecurrenceSchema.default(GoalRecurrence.MONTHLY),
    monthsCount: z.number().int().min(2).max(120).nullable().optional(),
    startMonth: monthSchema,
    /** filtro opcional por categoria (SPEND_MAX / EARN_MIN) */
    categoryId: z.string().nullable().optional(),
    notifySystem: z.boolean().default(true),
    notifyTelegram: z.boolean().default(false),
    notifyEmail: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .refine((v) => v.recurrence !== GoalRecurrence.N_MONTHS || !!v.monthsCount, {
    message: 'Informe por quantos meses',
    path: ['monthsCount'],
  });
export type CreateGoalBody = z.infer<typeof createGoalBodySchema>;

export const updateGoalBodySchema = z
  .object({
    title: z.string().min(1).max(120),
    targetAmount: centsSchema,
    recurrence: goalRecurrenceSchema,
    monthsCount: z.number().int().min(2).max(120).nullable(),
    startMonth: monthSchema,
    categoryId: z.string().nullable(),
    notifySystem: z.boolean(),
    notifyTelegram: z.boolean(),
    notifyEmail: z.boolean(),
    active: z.boolean(),
  })
  .partial();
export type UpdateGoalBody = z.infer<typeof updateGoalBodySchema>;

/** Progresso do objetivo no período corrente (ou no último período, se já terminou). */
export const goalProgressSchema = z.object({
  period: monthSchema, // período avaliado
  periodStart: z.string(),
  periodEnd: z.string(),
  isCurrent: z.boolean(), // o período ainda está em andamento
  current: z.number().int(), // valor apurado (gasto, recebido, saldo...)
  target: z.number().int(),
  /** 0..1+ — quanto do alvo já foi atingido (para "gastar até", quanto do teto foi usado) */
  ratio: z.number(),
  achieved: z.boolean(),
  onTrack: z.boolean(), // provável de bater (para metas ainda em andamento)
});
export type GoalProgress = z.infer<typeof goalProgressSchema>;

export const goalSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: goalTypeSchema,
  targetAmount: z.number().int(),
  recurrence: goalRecurrenceSchema,
  monthsCount: z.number().int().nullable(),
  startMonth: monthSchema,
  categoryId: z.string().nullable(),
  notifySystem: z.boolean(),
  notifyTelegram: z.boolean(),
  notifyEmail: z.boolean(),
  active: z.boolean(),
  createdAt: z.string(),
  timesAchieved: z.number().int(),
  lastAchievedPeriod: z.string().nullable(),
  progress: goalProgressSchema.nullable(),
});
export type Goal = z.infer<typeof goalSchema>;
