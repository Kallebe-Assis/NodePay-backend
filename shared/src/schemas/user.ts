import { z } from 'zod';
import { UserRole, UserStatus } from '../constants.js';
import { emailSchema, passwordSchema } from './auth.js';
import { paginationQuerySchema } from './common.js';

export const userRoleSchema = z.nativeEnum(UserRole);
export const userStatusSchema = z.nativeEnum(UserStatus);

/** Item da listagem de usuários (área admin). */
export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: userRoleSchema,
  status: userStatusSchema,
  createdAt: z.string(),
  approvedAt: z.string().nullable(),
  // métricas rápidas para a tabela admin
  counts: z
    .object({
      accounts: z.number().int(),
      transactions: z.number().int(),
      creditCards: z.number().int(),
    })
    .optional(),
});
export type User = z.infer<typeof userSchema>;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  status: userStatusSchema.optional(),
  role: userRoleSchema.optional(),
  search: z.string().max(120).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

/** Admin cria um usuário já ativo. */
export const adminCreateUserBodySchema = z.object({
  name: z.string().min(2).max(120),
  email: emailSchema,
  password: passwordSchema,
  role: userRoleSchema.default(UserRole.USER),
  status: userStatusSchema.default(UserStatus.ACTIVE),
});
export type AdminCreateUserBody = z.infer<typeof adminCreateUserBodySchema>;

export const adminUpdateUserBodySchema = z
  .object({
    name: z.string().min(2).max(120),
    role: userRoleSchema,
    status: userStatusSchema,
    password: passwordSchema,
  })
  .partial();
export type AdminUpdateUserBody = z.infer<typeof adminUpdateUserBodySchema>;
