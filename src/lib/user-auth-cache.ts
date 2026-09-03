import type { PrismaClient } from '@prisma/client';

/**
 * Cache curtíssimo (em memória, por processo) de `{ role, status }` de cada
 * usuário — para NÃO fazer 1 `SELECT` a cada requisição autenticada.
 *
 * Com o banco fora da mesma máquina (ex.: Supabase noutra região), esse SELECT
 * por request custava ~100-200 ms em TODAS as chamadas. Com o cache, um usuário
 * suspenso/promovido demora no máximo `AUTH_CACHE_TTL_MS` para refletir — e as
 * mutações de usuário (aprovar/suspender/editar/excluir) invalidam na hora.
 */

type Entry = { role: 'ADMIN' | 'USER'; status: 'PENDING' | 'ACTIVE' | 'SUSPENDED'; exp: number };

const TTL_MS = Math.max(0, Number(process.env.AUTH_CACHE_TTL_MS ?? 20_000));
const cache = new Map<string, Entry>();

/** Busca `{ role, status }` do usuário, servindo do cache quando possível. */
export async function getUserAuth(
  db: PrismaClient,
  userId: string,
): Promise<{ role: Entry['role']; status: Entry['status'] } | null> {
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && hit.exp > now) return { role: hit.role, status: hit.status };

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true },
  });
  if (!user) {
    cache.delete(userId);
    return null;
  }
  if (TTL_MS > 0) cache.set(userId, { ...user, exp: now + TTL_MS });
  return user;
}

/** Remove a entrada do cache (chamar após aprovar/suspender/editar/excluir usuário). */
export function invalidateUserAuth(userId: string): void {
  cache.delete(userId);
}
