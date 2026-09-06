import type { PrismaClient } from '@prisma/client';
import type { CreateAccountBody, ReconcileAccountBody, UpdateAccountBody } from '@nodepay/shared';
import { todaySP } from '@nodepay/shared';
import { Errors } from '../../lib/errors.js';
import { nb, numToBig } from '../../lib/money.js';
import { isoToDbDate } from '../../lib/date.js';
import { computeBalances } from './balance.js';

type Scope = { userId?: string };

export class AccountsService {
  constructor(private readonly db: PrismaClient) {}

  async list(scope: Scope, includeArchived = false) {
    const where = { ...(scope.userId ? { userId: scope.userId } : {}) };
    const [accounts, balances] = await Promise.all([
      this.db.account.findMany({
        where: { ...where, ...(includeArchived ? {} : { archived: false }) },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      }),
      computeBalances(this.db, scope),
    ]);
    return accounts.map((a) => this.present(a, balances.get(a.id)));
  }

  async get(scope: Scope, id: string) {
    const acc = await this.db.account.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
    });
    if (!acc) throw Errors.notFound('Conta');
    const balances = await computeBalances(this.db, { userId: acc.userId }, { accountId: id });
    return this.present(acc, balances.get(id));
  }

  async create(ownerId: string, body: CreateAccountBody) {
    const acc = await this.db.$transaction(async (tx) => {
      if (body.isDefault) {
        await tx.account.updateMany({ where: { userId: ownerId }, data: { isDefault: false } });
      }
      return tx.account.create({
        data: {
          userId: ownerId,
          name: body.name,
          type: body.type,
          openingBalance: numToBig(body.openingBalance ?? 0),
          color: body.color,
          icon: body.icon,
          bankId: body.bankId,
          isDefault: body.isDefault ?? false,
          includeInDashboard: body.includeInDashboard ?? true,
          archived: body.archived ?? false,
        },
      });
    });
    return this.present(acc, {
      currentBalance: nb(acc.openingBalance),
      projectedBalance: nb(acc.openingBalance),
    });
  }

  async update(scope: Scope, id: string, body: UpdateAccountBody) {
    const owner = await this.assertOwner(scope, id);
    const acc = await this.db.$transaction(async (tx) => {
      if (body.isDefault) {
        await tx.account.updateMany({
          where: { userId: owner, id: { not: id } },
          data: { isDefault: false },
        });
      }
      return tx.account.update({
        where: { id },
        data: {
          name: body.name,
          type: body.type,
          openingBalance: body.openingBalance != null ? numToBig(body.openingBalance) : undefined,
          color: body.color,
          icon: body.icon,
          bankId: body.bankId,
          isDefault: body.isDefault,
          includeInDashboard: body.includeInDashboard,
          archived: body.archived,
        },
      });
    });
    const balances = await computeBalances(this.db, { userId: owner }, { accountId: id });
    return this.present(acc, balances.get(id));
  }

  /**
   * Conciliação do SALDO ATUAL (liquidado) com o `targetBalance` informado.
   *  - mode 'adjustment' (padrão): cria um lançamento AJUSTE (PAGO) com a
   *    diferença, mantendo o histórico. Categoria "Ajuste de saldo".
   *  - mode 'opening': soma a diferença no saldo inicial da conta, sem gerar
   *    lançamento (útil quando o saldo inicial é que estava errado).
   */
  async reconcile(scope: Scope, id: string, body: ReconcileAccountBody) {
    const owner = await this.assertOwner(scope, id);
    const balances = await computeBalances(this.db, { userId: owner }, { accountId: id });
    const current = balances.get(id)?.currentBalance ?? 0;
    const delta = body.targetBalance - current;
    const mode = body.mode ?? 'adjustment';
    if (delta === 0) {
      return { adjusted: false, delta: 0, mode, transactionId: null, openingBalance: null };
    }

    if (mode === 'opening') {
      const acc = await this.db.account.findUniqueOrThrow({
        where: { id },
        select: { openingBalance: true },
      });
      const nextOpening = nb(acc.openingBalance) + delta;
      await this.db.account.update({
        where: { id },
        data: { openingBalance: numToBig(nextOpening) },
      });
      return { adjusted: true, delta, mode, transactionId: null, openingBalance: nextOpening };
    }

    const kind = delta > 0 ? 'INCOME' : 'EXPENSE';
    const category = await this.db.category.upsert({
      where: {
        userId_kind_name: { userId: owner, kind, name: 'Ajuste de saldo' },
      },
      create: { userId: owner, kind, name: 'Ajuste de saldo', icon: 'Scale' },
      update: {},
    });
    const date = isoToDbDate(body.date ?? todaySP());
    const tx = await this.db.transaction.create({
      data: {
        userId: owner,
        type: kind === 'INCOME' ? 'INCOME' : 'EXPENSE',
        amount: numToBig(Math.abs(delta)),
        paidAmount: numToBig(Math.abs(delta)),
        description: body.note?.trim() || 'Ajuste de saldo (conciliação)',
        competenceDate: date,
        dueDate: date,
        paidDate: date,
        status: 'PAID',
        accountId: id,
        categoryId: category.id,
      },
    });
    return { adjusted: true, delta, mode, transactionId: tx.id, openingBalance: null };
  }

  async remove(scope: Scope, id: string) {
    await this.assertOwner(scope, id);
    const count = await this.db.transaction.count({ where: { accountId: id } });
    if (count > 0) {
      await this.db.account.update({ where: { id }, data: { archived: true } });
      return { archived: true };
    }
    await this.db.account.delete({ where: { id } });
    return { deleted: true };
  }

  private async assertOwner(scope: Scope, id: string): Promise<string> {
    const acc = await this.db.account.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
      select: { userId: true },
    });
    if (!acc) throw Errors.notFound('Conta');
    return acc.userId;
  }

  private present(a: any, balances?: { currentBalance: number; projectedBalance: number }) {
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      openingBalance: nb(a.openingBalance),
      color: a.color,
      icon: a.icon,
      bankId: a.bankId ?? null,
      isDefault: a.isDefault,
      includeInDashboard: a.includeInDashboard,
      archived: a.archived,
      createdAt: a.createdAt.toISOString(),
      currentBalance: balances?.currentBalance ?? nb(a.openingBalance),
      projectedBalance: balances?.projectedBalance ?? nb(a.openingBalance),
    };
  }
}
