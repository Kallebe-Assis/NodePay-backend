import { z } from 'zod';

export const emailSchema = z.string().email('E-mail inválido').max(160).toLowerCase();
export const passwordSchema = z
  .string()
  .min(8, 'A senha deve ter ao menos 8 caracteres')
  .max(128);

export const registerBodySchema = z.object({
  name: z.string().min(2, 'Informe seu nome').max(120),
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterBody = z.infer<typeof registerBodySchema>;

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Informe a senha'),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshBody = z.infer<typeof refreshBodySchema>;

export const updateProfileBodySchema = z.object({
  name: z.string().min(2, 'Informe seu nome').max(120),
});
export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;

export const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1, 'Informe a senha atual'),
  newPassword: passwordSchema,
});
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;

export const authUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(['ADMIN', 'USER']),
  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED']),
  createdAt: z.string(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

/** Resposta do /register quando a conta cai em aprovação pendente. */
export const registrationPendingSchema = z.object({
  status: z.literal('PENDING'),
  message: z.string(),
});
export type RegistrationPending = z.infer<typeof registrationPendingSchema>;

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int(),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

export const authResponseSchema = z.object({
  user: authUserSchema,
  tokens: authTokensSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;
