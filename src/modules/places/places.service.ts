import type { PrismaClient, TransactionType } from '@prisma/client';
import type { CreatePlaceBody, ListPlacesQuery, UpdatePlaceBody } from '@nodepay/shared';
import { endOfMonth, startOfMonth, todaySP, type IsoDate } from '@nodepay/shared';
import { Errors } from '../../lib/errors.js';
import { nb } from '../../lib/money.js';
import { isoToDbDate } from '../../lib/date.js';

type Scope = { userId?: string };

/** Tipos que contam como "gasto" no local (mesmo critério do orçamento por categoria). */
const SPEND_TYPES: TransactionType[] = ['EXPENSE', 'CARD_EXPENSE'];

export class PlacesService {
  constructor(private readonly db: PrismaClient) {}

  async list(scope: Scope, q: ListPlacesQuery) {
    const where = {
      ...(scope.userId ? { userId: scope.userId } : {}),
      ...(q.includeArchived ? {} : { archived: false }),
    };
    const rows = await this.db.place.findMany({
      where,
      orderBy: [{ archived: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { transactions: true } } },
    });

    if (!scope.userId || rows.length === 0) {
      return rows.map((p) => this.present(p));
    }

    const anchor = `${q.month ?? todaySP().slice(0, 7)}-01` as IsoDate;
    const from = isoToDbDate(startOfMonth(anchor));
    const to = isoToDbDate(endOfMonth(anchor));
    const spentByPlace = await this.db.transaction.groupBy({
      by: ['placeId'],
      where: {
        userId: scope.userId,
        type: { in: SPEND_TYPES },
        status: { not: 'CANCELED' },
        competenceDate: { gte: from, lte: to },
        placeId: { not: null },
      },
      _sum: { amount: true },
    });
    const spent = new Map(spentByPlace.map((r) => [r.placeId, nb(r._sum.amount)]));

    return rows.map((p) => this.present(p, spent.get(p.id) ?? 0));
  }

  async get(scope: Scope, id: string) {
    const p = await this.db.place.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
      include: { _count: { select: { transactions: true } } },
    });
    if (!p) throw Errors.notFound('Local de compra');
    return this.present(p);
  }

  async create(ownerId: string, body: CreatePlaceBody) {
    const row = await this.db.place.create({
      data: {
        userId: ownerId,
        name: body.name,
        logoUrl: body.logoUrl || null,
        icon: body.icon || null,
        address: body.address || null,
        city: body.city || null,
        state: body.state ? body.state.toUpperCase() : null,
        color: body.color || null,
      },
      include: { _count: { select: { transactions: true } } },
    });
    return this.present(row);
  }

  async update(scope: Scope, id: string, body: UpdatePlaceBody) {
    const current = await this.db.place.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
    });
    if (!current) throw Errors.notFound('Local de compra');
    const row = await this.db.place.update({
      where: { id },
      data: {
        name: body.name,
        logoUrl: body.logoUrl === '' ? null : body.logoUrl,
        icon: body.icon,
        address: body.address,
        city: body.city,
        state: body.state ? body.state.toUpperCase() : body.state,
        color: body.color,
        archived: body.archived,
      },
      include: { _count: { select: { transactions: true } } },
    });
    return this.present(row);
  }

  async remove(scope: Scope, id: string) {
    const current = await this.db.place.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
      include: { _count: { select: { transactions: true } } },
    });
    if (!current) throw Errors.notFound('Local de compra');
    if (current._count.transactions > 0) {
      await this.db.place.update({ where: { id }, data: { archived: true } });
      return { archived: true };
    }
    await this.db.place.delete({ where: { id } });
    return { deleted: true };
  }

  private present(p: any, spentThisMonth?: number) {
    return {
      id: p.id,
      name: p.name,
      logoUrl: p.logoUrl,
      icon: p.icon,
      address: p.address,
      city: p.city,
      state: p.state,
      color: p.color,
      archived: p.archived,
      createdAt: p.createdAt.toISOString(),
      transactionCount: p._count?.transactions ?? 0,
      ...(spentThisMonth !== undefined ? { spentThisMonth } : {}),
    };
  }
}
