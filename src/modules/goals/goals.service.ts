import type { PrismaClient } from '@prisma/client';
import type { CreateGoalBody, UpdateGoalBody } from '@nodepay/shared';
import { Errors } from '../../lib/errors.js';
import { nb, numToBig } from '../../lib/money.js';
import { isoToDbDate } from '../../lib/date.js';
import { evaluateGoal } from './goal.eval.js';

type Scope = { userId?: string };

export class GoalsService {
  constructor(private readonly db: PrismaClient) {}

  async list(scope: Scope) {
    const goals = await this.db.goal.findMany({
      where: { ...(scope.userId ? { userId: scope.userId } : {}) },
      orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
    });
    return Promise.all(goals.map((g) => this.present(g)));
  }

  async get(scope: Scope, id: string) {
    const g = await this.db.goal.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
    });
    if (!g) throw Errors.notFound('Objetivo');
    return this.present(g);
  }

  async create(ownerId: string, body: CreateGoalBody) {
    if (body.categoryId) await this.assertCategory(ownerId, body.categoryId);
    const g = await this.db.goal.create({
      data: {
        userId: ownerId,
        title: body.title,
        type: body.type,
        targetAmount: numToBig(body.targetAmount),
        recurrence: body.recurrence,
        monthsCount: body.recurrence === 'N_MONTHS' ? (body.monthsCount ?? null) : null,
        startMonth: isoToDbDate(`${body.startMonth}-01`),
        categoryId: body.categoryId ?? null,
        notifySystem: body.notifySystem ?? true,
        notifyTelegram: body.notifyTelegram ?? false,
        notifyEmail: body.notifyEmail ?? false,
        active: body.active ?? true,
      },
    });
    return this.present(g);
  }

  async update(scope: Scope, id: string, body: UpdateGoalBody) {
    const current = await this.db.goal.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
    });
    if (!current) throw Errors.notFound('Objetivo');
    if (body.categoryId) await this.assertCategory(current.userId, body.categoryId);

    const g = await this.db.goal.update({
      where: { id },
      data: {
        title: body.title,
        type: undefined, // tipo não muda depois de criado
        targetAmount: body.targetAmount != null ? numToBig(body.targetAmount) : undefined,
        recurrence: body.recurrence,
        monthsCount: body.monthsCount === undefined ? undefined : body.monthsCount,
        startMonth: body.startMonth ? isoToDbDate(`${body.startMonth}-01`) : undefined,
        categoryId: body.categoryId,
        notifySystem: body.notifySystem,
        notifyTelegram: body.notifyTelegram,
        notifyEmail: body.notifyEmail,
        active: body.active,
      },
    });
    return this.present(g);
  }

  async remove(scope: Scope, id: string) {
    const g = await this.db.goal.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
      select: { id: true },
    });
    if (!g) throw Errors.notFound('Objetivo');
    await this.db.goal.delete({ where: { id } });
    return { deleted: true };
  }

  private async assertCategory(userId: string, categoryId: string) {
    const ok = await this.db.category.findFirst({
      where: { id: categoryId, userId },
      select: { id: true },
    });
    if (!ok) throw Errors.badRequest('Categoria inválida');
  }

  private async present(g: any) {
    const progress = g.active
      ? await evaluateGoal(this.db, g.userId, g).catch(() => null)
      : null;
    return {
      id: g.id,
      title: g.title,
      type: g.type,
      targetAmount: nb(g.targetAmount),
      recurrence: g.recurrence,
      monthsCount: g.monthsCount,
      startMonth: `${g.startMonth.getUTCFullYear()}-${String(g.startMonth.getUTCMonth() + 1).padStart(2, '0')}`,
      categoryId: g.categoryId,
      notifySystem: g.notifySystem,
      notifyTelegram: g.notifyTelegram,
      notifyEmail: g.notifyEmail,
      active: g.active,
      createdAt: g.createdAt.toISOString(),
      timesAchieved: g.timesAchieved ?? 0,
      lastAchievedPeriod: g.lastAchievedPeriod ?? null,
      progress,
    };
  }
}
