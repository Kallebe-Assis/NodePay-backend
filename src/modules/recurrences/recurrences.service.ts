import type { PrismaClient } from '@prisma/client';
import type { UpdateRecurrenceBody } from '@nodepay/shared';
import { Errors } from '../../lib/errors.js';
import { nb } from '../../lib/money.js';
import { dbDateToIso, isoToDbDate } from '../../lib/date.js';

type Scope = { userId?: string };

export class RecurrencesService {
  constructor(private readonly db: PrismaClient) {}

  async list(scope: Scope) {
    const rows = await this.db.recurrence.findMany({
      where: { ...(scope.userId ? { userId: scope.userId } : {}) },
      orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
    });
    const counts = await this.db.transaction.groupBy({
      by: ['recurrenceId'],
      where: {
        recurrenceId: { in: rows.map((r) => r.id) },
        status: { in: ['PENDING', 'SCHEDULED'] },
      },
      _count: { _all: true },
    });
    const upcoming = new Map(counts.map((c) => [c.recurrenceId, c._count._all]));
    return rows.map((r) => this.present(r, upcoming.get(r.id) ?? 0));
  }

  async get(scope: Scope, id: string) {
    const r = await this.db.recurrence.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
    });
    if (!r) throw Errors.notFound('Recorrência');
    const upcoming = await this.db.transaction.count({
      where: { recurrenceId: id, status: { in: ['PENDING', 'SCHEDULED'] } },
    });
    return this.present(r, upcoming);
  }

  /** Pausar/retomar (active) ou encerrar numa data (endDate). */
  async update(scope: Scope, id: string, body: UpdateRecurrenceBody) {
    const cur = await this.db.recurrence.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
    });
    if (!cur) throw Errors.notFound('Recorrência');

    await this.db.recurrence.update({
      where: { id },
      data: {
        ...(body.active === undefined ? {} : { active: body.active }),
        ...(body.endDate === undefined
          ? {}
          : { endDate: body.endDate ? isoToDbDate(body.endDate) : null }),
      },
    });

    // Encerrar numa data: cancela as ocorrências futuras ainda não pagas.
    if (body.endDate) {
      await this.db.transaction.updateMany({
        where: {
          recurrenceId: id,
          status: { in: ['PENDING', 'SCHEDULED'] },
          competenceDate: { gt: isoToDbDate(body.endDate) },
        },
        data: { status: 'CANCELED' },
      });
    }
    return this.get(scope, id);
  }

  /** Apaga a regra e todas as ocorrências ainda não pagas. */
  async remove(scope: Scope, id: string) {
    const cur = await this.db.recurrence.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
    });
    if (!cur) throw Errors.notFound('Recorrência');
    await this.db.transaction.deleteMany({
      where: { recurrenceId: id, status: { in: ['PENDING', 'SCHEDULED'] } },
    });
    await this.db.recurrence.delete({ where: { id } });
    return { deleted: true };
  }

  private present(r: {
    id: string;
    mode: 'FIXED' | 'INSTALLMENT';
    frequency: 'WEEKLY' | 'MONTHLY' | 'YEARLY';
    interval: number;
    direction: string;
    amount: bigint;
    description: string;
    accountId: string | null;
    categoryId: string | null;
    startDate: Date;
    endDate: Date | null;
    occurrences: number | null;
    materializedUntil: Date | null;
    active: boolean;
  }, upcomingCount: number) {
    return {
      id: r.id,
      mode: r.mode,
      frequency: r.frequency,
      interval: r.interval,
      direction: r.direction === 'income' ? ('income' as const) : ('expense' as const),
      amount: nb(r.amount),
      description: r.description,
      accountId: r.accountId,
      categoryId: r.categoryId,
      startDate: dbDateToIso(r.startDate),
      endDate: r.endDate ? dbDateToIso(r.endDate) : null,
      occurrences: r.occurrences,
      materializedUntil: r.materializedUntil ? dbDateToIso(r.materializedUntil) : null,
      active: r.active,
      upcomingCount,
    };
  }
}
