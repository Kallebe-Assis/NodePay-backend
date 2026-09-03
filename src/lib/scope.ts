import type { FastifyRequest } from 'fastify';
import { Errors } from './errors.js';

/**
 * Resolve por qual `userId` filtrar os dados de um recurso.
 *
 *  - USER  : sempre o próprio id (o `userId` da query é ignorado).
 *  - ADMIN : o `userId` informado (ver dados de um usuário específico) ou
 *            `undefined` = sem filtro = todos os usuários.
 */
export function ownerFilter(req: FastifyRequest, requestedUserId?: string): { userId?: string } {
  if (req.userRole === 'ADMIN') {
    return requestedUserId ? { userId: requestedUserId } : {};
  }
  return { userId: req.userId };
}

/**
 * Para escritas: o dono do registro que será criado/alterado.
 *  - USER  : ele mesmo.
 *  - ADMIN : `requestedUserId` se informado, senão ele mesmo.
 */
export function targetOwnerId(req: FastifyRequest, requestedUserId?: string): string {
  if (req.userRole === 'ADMIN' && requestedUserId) return requestedUserId;
  return req.userId;
}

/** Garante que um USER não está tentando agir sobre dados de outro. */
export function assertCanAct(req: FastifyRequest, ownerId: string): void {
  if (req.userRole !== 'ADMIN' && ownerId !== req.userId) {
    throw Errors.forbidden();
  }
}
