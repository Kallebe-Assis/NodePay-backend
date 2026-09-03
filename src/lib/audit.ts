import type { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

export interface AuditEntry {
  /** quem executou a ação (id do usuário autenticado) */
  actorId: string;
  /** tabela/recurso afetado, ex.: 'user' */
  entity: string;
  /** id do registro afetado */
  entityId: string;
  /** 'create' | 'update' | 'delete' | 'approve' | 'suspend' | 'self-delete' | ... */
  action: string;
  /** o que mudou (campos antes/depois, ou um resumo) — nunca inclua segredos/hash */
  diff?: Prisma.InputJsonValue;
}

/**
 * Registra uma ação sensível na tabela `audit_logs`. Best-effort: uma falha de
 * escrita aqui nunca deve derrubar a operação principal — só é logada.
 */
export async function writeAudit(db: Db, entry: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        userId: entry.actorId,
        entity: entry.entity,
        entityId: entry.entityId,
        action: entry.action,
        diff: entry.diff,
      },
    });
  } catch {
    // silencioso de propósito — auditoria não pode quebrar o fluxo
  }
}

/** Monta um diff enxuto {campo: {from, to}} só com os campos que mudaram. */
export function shallowDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key.toLowerCase().includes('password') || key.toLowerCase().includes('hash')) continue;
    if (before[key] !== after[key]) out[key] = { from: before[key], to: after[key] };
  }
  return out;
}
