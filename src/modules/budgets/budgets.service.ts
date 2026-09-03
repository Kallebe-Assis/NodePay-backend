import type { PrismaClient, TransactionType } from '@prisma/client';
import type { BudgetBulkInput, BudgetInput, IsoDate } from '@nodepay/shared';
import { endOfMonth, startOfMonth, todaySP } from '@nodepay/shared';
import { Errors } from '../../lib/errors.js';
import { nb, numToBig } from '../../lib/money.js';
import { isoToDbDate } from '../../lib/date.js';

type Scope = { userId?: string };

/** Tipos que contam como "gasto na categoria" para o orçamento. */
const SPEND_TYPES: TransactionType[] = ['EXPENSE', 'CARD_EXPENSE'];

export class BudgetsService {
  constructor(private readonly db: PrismaClient) {}

  /** Lista os orçamentos com o consumo do mês (padrão: mês corrente). */
  async list(scope: Scope, month?: string) {
    if (!scope.userId) return { month: month ?? todaySP().slice(0, 7), totalBudget: 0, totalSpent: 0, items: [] };
    const userId = scope.userId;
    const anchor = `${month ?? todaySP().slice(0, 7)}-01` as IsoDate;
    const from = isoToDbDate(startOfMonth(anchor));
    const to = isoToDbDate(endOfMonth(anchor));

    const [budgets, spentByCat] = await Promise.all([
      this.db.budget.findMany({
        where: { userId },
        include: { category: { select: { name: true, color: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.transaction.groupBy({
        by: ['categoryId'],
        where: {
          userId,
          type: { in: SPEND_TYPES },
          status: { not: 'CANCELED' },
          competenceDate: { gte: from, lte: to },
          categoryId: { not: null },
        },
        _sum: { amount: true },
      }),
    ]);

    const spent = new Map(spentByCat.map((r) => [r.categoryId, nb(r._sum.amount)]));

    const items = budgets.map((b) => {
      const amount = nb(b.amount);
      const used = spent.get(b.categoryId) ?? 0;
      return {
        id: b.id,
        categoryId: b.categoryId,
        categoryName: b.category.name,
        color: b.category.color,
        amount,
        spent: used,
        remaining: amount - used,
        usage: amount > 0 ? used / amount : 0,
        active: b.active,
        month: anchor.slice(0, 7),
      };
    });

    return {
      month: anchor.slice(0, 7),
      totalBudget: items.reduce((s, i) => s + (i.active ? i.amount : 0), 0),
      totalSpent: items.reduce((s, i) => s + (i.active ? i.spent : 0), 0),
      items,
    };
  }

  async upsert(ownerId: string, body: BudgetInput) {
    await this.assertExpenseCategory(ownerId, body.categoryId);
    await this.db.budget.upsert({
      where: { userId_categoryId: { userId: ownerId, categoryId: body.categoryId } },
      create: {
        userId: ownerId,
        categoryId: body.categoryId,
        amount: numToBig(body.amount),
        active: body.active ?? true,
      },
      update: {
        amount: numToBig(body.amount),
        ...(body.active === undefined ? {} : { active: body.active }),
      },
    });
    return this.list({ userId: ownerId });
  }

  /** Define/zera vários tetos de uma vez. amount 0 => remove o orçamento. */
  async bulk(ownerId: string, body: BudgetBulkInput) {
    const ids = body.items.map((i) => i.categoryId);
    if (ids.length) {
      const owned = await this.db.category.count({
        where: { id: { in: ids }, userId: ownerId, kind: 'EXPENSE' },
      });
      if (owned !== new Set(ids).size) throw Errors.badRequest('Categoria inválida na lista.');
    }
    await this.db.$transaction(
      body.items.map((i) =>
        i.amount <= 0
          ? this.db.budget.deleteMany({ where: { userId: ownerId, categoryId: i.categoryId } })
          : this.db.budget.upsert({
              where: { userId_categoryId: { userId: ownerId, categoryId: i.categoryId } },
              create: { userId: ownerId, categoryId: i.categoryId, amount: numToBig(i.amount) },
              update: { amount: numToBig(i.amount) },
            }),
      ),
    );
    return this.list({ userId: ownerId });
  }

  async remove(scope: Scope, id: string) {
    const b = await this.db.budget.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
    });
    if (!b) throw Errors.notFound('Orçamento');
    await this.db.budget.delete({ where: { id } });
    return { deleted: true };
  }

  private async assertExpenseCategory(userId: string, categoryId: string) {
    const c = await this.db.category.findFirst({
      where: { id: categoryId, userId, kind: 'EXPENSE' },
      select: { id: true },
    });
    if (!c) throw Errors.badRequest('Selecione uma categoria de despesa válida.');
  }
}
