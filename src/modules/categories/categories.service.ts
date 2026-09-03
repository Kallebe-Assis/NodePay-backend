import type { PrismaClient } from '@prisma/client';
import type { CreateCategoryBody, UpdateCategoryBody } from '@nodepay/shared';
import { Errors } from '../../lib/errors.js';

type Scope = { userId?: string };

export class CategoriesService {
  constructor(private readonly db: PrismaClient) {}

  async list(scope: Scope, filter: { kind?: 'INCOME' | 'EXPENSE'; parentId?: string | null } = {}) {
    const rows = await this.db.category.findMany({
      where: {
        ...(scope.userId ? { userId: scope.userId } : {}),
        ...(filter.kind ? { kind: filter.kind } : {}),
        ...(filter.parentId !== undefined ? { parentId: filter.parentId } : {}),
      },
      orderBy: [{ kind: 'asc' }, { parentId: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { children: true, transactions: true } } },
    });
    return rows.map((c) => this.present(c));
  }

  async get(scope: Scope, id: string) {
    const c = await this.db.category.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
      include: { _count: { select: { children: true, transactions: true } } },
    });
    if (!c) throw Errors.notFound('Categoria');
    return this.present(c);
  }

  async create(ownerId: string, body: CreateCategoryBody) {
    if (body.parentId) await this.validateParent(ownerId, body.parentId, body.kind);
    const row = await this.db.category.create({
      data: {
        userId: ownerId,
        name: body.name,
        kind: body.kind,
        parentId: body.parentId ?? null,
        color: body.color,
        icon: body.icon,
      },
      include: { _count: { select: { children: true, transactions: true } } },
    });
    return this.present(row);
  }

  async update(scope: Scope, id: string, body: UpdateCategoryBody) {
    const current = await this.db.category.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
    });
    if (!current) throw Errors.notFound('Categoria');

    if (body.parentId !== undefined && body.parentId !== null) {
      if (body.parentId === id) throw Errors.badRequest('Uma categoria não pode ser pai de si mesma');
      const kind = body.kind ?? current.kind;
      await this.validateParent(current.userId, body.parentId, kind);
      const hasChildren = await this.db.category.count({ where: { parentId: id } });
      if (hasChildren > 0) {
        throw Errors.badRequest('Categoria com subcategorias não pode virar subcategoria');
      }
    }

    const row = await this.db.category.update({
      where: { id },
      data: {
        name: body.name,
        kind: body.kind,
        parentId: body.parentId,
        color: body.color,
        icon: body.icon,
      },
      include: { _count: { select: { children: true, transactions: true } } },
    });
    return this.present(row);
  }

  async remove(scope: Scope, id: string) {
    const current = await this.db.category.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
      select: { id: true },
    });
    if (!current) throw Errors.notFound('Categoria');
    // filhos ficam sem pai (SetNull no schema); lançamentos ficam sem categoria
    await this.db.category.delete({ where: { id } });
    return { deleted: true };
  }

  private async validateParent(ownerId: string, parentId: string, kind: 'INCOME' | 'EXPENSE') {
    const parent = await this.db.category.findFirst({
      where: { id: parentId, userId: ownerId },
      select: { kind: true, parentId: true },
    });
    if (!parent) throw Errors.badRequest('Categoria pai inválida');
    if (parent.kind !== kind) throw Errors.badRequest('A subcategoria deve ser do mesmo tipo do pai');
    if (parent.parentId) throw Errors.badRequest('Só é permitido um nível de subcategoria');
  }

  private present(c: any) {
    return {
      id: c.id,
      name: c.name,
      kind: c.kind,
      parentId: c.parentId,
      color: c.color,
      icon: c.icon,
      createdAt: c.createdAt.toISOString(),
      childCount: c._count?.children ?? 0,
      transactionCount: c._count?.transactions ?? 0,
    };
  }
}
