import type { Prisma, PrismaClient } from '@prisma/client';
import type { CategoryRuleInput } from '@nodepay/shared';
import { Errors } from '../../lib/errors.js';

type Scope = { userId?: string };
type Db = PrismaClient | Prisma.TransactionClient;

/** minúsculo, sem acento, espaços colapsados. */
export function normalizeMatch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve a categoria de uma descrição pelas regras do usuário.
 * Maior `priority` vence; empate → regra mais antiga.
 */
export async function matchCategoryRule(
  db: Db,
  userId: string,
  description: string,
): Promise<{ categoryId: string; ruleId: string } | null> {
  const rules = await db.categoryRule.findMany({
    where: { userId, active: true },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    select: { id: true, match: true, categoryId: true },
  });
  const hay = normalizeMatch(description);
  for (const r of rules) {
    if (r.match && hay.includes(r.match)) return { categoryId: r.categoryId, ruleId: r.id };
  }
  return null;
}

export class CategoryRulesService {
  constructor(private readonly db: PrismaClient) {}

  async list(scope: Scope) {
    const rows = await this.db.categoryRule.findMany({
      where: { ...(scope.userId ? { userId: scope.userId } : {}) },
      include: { category: { select: { name: true, color: true } } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      match: r.match,
      categoryId: r.categoryId,
      categoryName: r.category.name,
      color: r.category.color,
      priority: r.priority,
      active: r.active,
    }));
  }

  async create(ownerId: string, body: CategoryRuleInput) {
    await this.assertCategory(ownerId, body.categoryId);
    await this.db.categoryRule.create({
      data: {
        userId: ownerId,
        match: normalizeMatch(body.match),
        categoryId: body.categoryId,
        priority: body.priority ?? 0,
        active: body.active ?? true,
      },
    });
    return this.list({ userId: ownerId });
  }

  async update(scope: Scope, id: string, body: Partial<CategoryRuleInput>) {
    const cur = await this.db.categoryRule.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
    });
    if (!cur) throw Errors.notFound('Regra');
    if (body.categoryId) await this.assertCategory(cur.userId, body.categoryId);
    await this.db.categoryRule.update({
      where: { id },
      data: {
        match: body.match !== undefined ? normalizeMatch(body.match) : undefined,
        categoryId: body.categoryId,
        priority: body.priority,
        active: body.active,
      },
    });
    return this.list({ userId: cur.userId });
  }

  async remove(scope: Scope, id: string) {
    const cur = await this.db.categoryRule.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
    });
    if (!cur) throw Errors.notFound('Regra');
    await this.db.categoryRule.delete({ where: { id } });
    return { deleted: true };
  }

  async match(scope: Scope, description: string) {
    if (!scope.userId) return { categoryId: null, ruleId: null };
    const hit = await matchCategoryRule(this.db, scope.userId, description);
    return { categoryId: hit?.categoryId ?? null, ruleId: hit?.ruleId ?? null };
  }

  private async assertCategory(userId: string, categoryId: string) {
    const c = await this.db.category.findFirst({
      where: { id: categoryId, userId },
      select: { id: true },
    });
    if (!c) throw Errors.badRequest('Categoria inválida.');
  }
}
