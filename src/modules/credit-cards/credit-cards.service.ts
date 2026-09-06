import type { PrismaClient } from '@prisma/client';
import type { CreateCreditCardBody, UpdateCreditCardBody } from '@nodepay/shared';
import { Errors } from '../../lib/errors.js';
import { nb, numToBig } from '../../lib/money.js';
import { dbDateToIso } from '../../lib/date.js';

type NextInvoice = { total: number; dueDate: string } | null;

type Scope = { userId?: string };

export class CreditCardsService {
  constructor(private readonly db: PrismaClient) {}

  async list(scope: Scope, includeArchived = false) {
    const userWhere = scope.userId ? { userId: scope.userId } : {};
    const cards = await this.db.creditCard.findMany({
      where: { ...userWhere, ...(includeArchived ? {} : { archived: false }) },
      orderBy: { createdAt: 'asc' },
    });

    const totals = await this.db.invoice.groupBy({
      by: ['creditCardId'],
      where: { ...userWhere, status: { in: ['OPEN', 'CLOSED'] } },
      _sum: { total: true },
    });
    const openByCard = new Map(totals.map((t) => [t.creditCardId, nb(t._sum.total)]));

    // "próxima fatura" = a não-paga que vence primeiro (por cartão)
    const upcoming = await this.db.invoice.findMany({
      where: { ...userWhere, status: { in: ['OPEN', 'CLOSED'] } },
      orderBy: { dueDate: 'asc' },
      select: { creditCardId: true, total: true, dueDate: true },
    });
    const nextByCard = new Map<string, NextInvoice>();
    for (const inv of upcoming) {
      if (nextByCard.has(inv.creditCardId)) continue;
      nextByCard.set(inv.creditCardId, { total: nb(inv.total), dueDate: dbDateToIso(inv.dueDate) });
    }

    return cards.map((c) =>
      this.present(c, openByCard.get(c.id) ?? 0, nextByCard.get(c.id) ?? null),
    );
  }

  async get(scope: Scope, id: string) {
    const card = await this.db.creditCard.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
    });
    if (!card) throw Errors.notFound('Cartão');
    const agg = await this.db.invoice.aggregate({
      where: { creditCardId: id, status: { in: ['OPEN', 'CLOSED'] } },
      _sum: { total: true },
    });
    const next = await this.db.invoice.findFirst({
      where: { creditCardId: id, status: { in: ['OPEN', 'CLOSED'] } },
      orderBy: { dueDate: 'asc' },
      select: { total: true, dueDate: true },
    });
    return this.present(
      card,
      nb(agg._sum.total),
      next ? { total: nb(next.total), dueDate: dbDateToIso(next.dueDate) } : null,
    );
  }

  async create(ownerId: string, body: CreateCreditCardBody) {
    this.validateCycle(body.closingDay, body.dueDay);
    const card = await this.db.creditCard.create({
      data: {
        userId: ownerId,
        name: body.name,
        lastDigits: body.lastDigits,
        brand: body.brand,
        bankId: body.bankId,
        creditLimit: numToBig(body.creditLimit ?? 0),
        closingDay: body.closingDay,
        dueDay: body.dueDay,
        defaultPaymentAccountId: body.defaultPaymentAccountId ?? null,
        color: body.color,
        archived: body.archived ?? false,
      },
    });
    return this.present(card, 0, null);
  }

  async update(scope: Scope, id: string, body: UpdateCreditCardBody) {
    await this.assertOwner(scope, id);
    if (body.closingDay != null && body.dueDay != null) {
      this.validateCycle(body.closingDay, body.dueDay);
    }
    const card = await this.db.creditCard.update({
      where: { id },
      data: {
        name: body.name,
        lastDigits: body.lastDigits,
        brand: body.brand,
        bankId: body.bankId,
        creditLimit: body.creditLimit != null ? numToBig(body.creditLimit) : undefined,
        closingDay: body.closingDay,
        dueDay: body.dueDay,
        defaultPaymentAccountId: body.defaultPaymentAccountId,
        color: body.color,
        archived: body.archived,
      },
    });
    return this.get({ userId: card.userId }, card.id);
  }

  async remove(scope: Scope, id: string) {
    await this.assertOwner(scope, id);
    const count = await this.db.transaction.count({ where: { creditCardId: id } });
    if (count > 0) {
      await this.db.creditCard.update({ where: { id }, data: { archived: true } });
      return { archived: true };
    }
    await this.db.creditCard.delete({ where: { id } });
    return { deleted: true };
  }

  private validateCycle(closingDay: number, dueDay: number) {
    if (closingDay === dueDay) {
      throw Errors.badRequest('Dia de fechamento e vencimento não podem ser iguais');
    }
  }

  private async assertOwner(scope: Scope, id: string) {
    const ok = await this.db.creditCard.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
      select: { id: true },
    });
    if (!ok) throw Errors.notFound('Cartão');
  }

  private present(c: any, openInvoiceTotal: number, next: NextInvoice) {
    const limit = nb(c.creditLimit);
    return {
      id: c.id,
      name: c.name,
      lastDigits: c.lastDigits,
      brand: c.brand,
      bankId: c.bankId,
      creditLimit: limit,
      closingDay: c.closingDay,
      dueDay: c.dueDay,
      defaultPaymentAccountId: c.defaultPaymentAccountId,
      color: c.color,
      archived: c.archived,
      createdAt: c.createdAt.toISOString(),
      openInvoiceTotal,
      nextInvoiceTotal: next?.total ?? 0,
      nextInvoiceDueDate: next?.dueDate ?? null,
      availableLimit: Math.max(limit - openInvoiceTotal, 0),
    };
  }
}
