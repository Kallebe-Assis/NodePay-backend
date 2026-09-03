import { z } from 'zod';
import { isoDateSchema } from './common.js';

export const notificationKindSchema = z.enum([
  'bill_due', // conta a vencer / vencida
  'invoice_closing', // fatura de cartão fechando
  'low_balance', // saldo projetado abaixo do limite
  'weekly_summary', // resumo semanal
  'pending_user', // (admin) usuário aguardando aprovação
  'goal_achieved', // objetivo conquistado no período
  'goal_missed', // objetivo não atingido no período encerrado
]);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

export const notificationSchema = z.object({
  id: z.string(), // determinístico (kind + ref) para dedupe no cliente
  kind: notificationKindSchema,
  severity: z.enum(['info', 'warning', 'danger']),
  title: z.string(),
  body: z.string(),
  date: isoDateSchema.nullable(),
  amount: z.number().int().nullable(),
  /** rota do app para onde o clique leva */
  href: z.string().nullable(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationsResponseSchema = z.object({
  items: z.array(notificationSchema),
  unread: z.number().int(), // total (o "lido" é controlado no cliente)
});
export type NotificationsResponse = z.infer<typeof notificationsResponseSchema>;
