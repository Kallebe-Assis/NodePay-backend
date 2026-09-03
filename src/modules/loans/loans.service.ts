import type { PrismaClient } from '@prisma/client';
import {
  buildSchedule,
  type CreateLoanBody,
  type SettleLoanBody,
  todaySP,
} from '@nodepay/shared';
import { Errors } from '../../lib/errors.js';
import { nb, numToBig } from '../../lib/money.js';
import { dbDateToIso, isoToDbDate } from '../../lib/date.js';

export class LoansService {
  constructor(private readonly db: PrismaClient) {}

  private static readonly installmentInclude = {
    installments: {
      orderBy: { number: 'asc' as const },
      include: { payment: { select: { id: true, status: true } } },
    },
  };

  async list(scope: { userId?: string }) {
    const loans = await this.db.loan.findMany({
      where: { ...(scope.userId ? { userId: scope.userId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: LoansService.installmentInclude,
    });
    return loans.map((l) => this.present(l, false));
  }

  async get(scope: { userId?: string }, id: string) {
    const loan = await this.db.loan.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
      include: LoansService.installmentInclude,
    });
    if (!loan) throw Errors.notFound('Empréstimo');
    return this.present(loan, true);
  }

  async update(
    scope: { userId?: string },
    id: string,
    body: { lender?: string; notes?: string | null },
  ) {
    const loan = await this.db.loan.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
      select: { id: true, userId: true },
    });
    if (!loan) throw Errors.notFound('Empréstimo');
    await this.db.loan.update({
      where: { id },
      data: { lender: body.lender, notes: body.notes },
    });
    return this.get({ userId: loan.userId }, id);
  }

  async create(userId: string, body: CreateLoanBody) {
    const monthlyRate = body.monthlyInterestPercent / 100;
    const schedule = buildSchedule({
      principal: body.principal,
      monthlyRate,
      installments: body.installments,
      firstDueDate: body.firstDueDate,
      system: body.system,
    });

    return this.db.$transaction(async (tx) => {
      if (body.disbursementAccountId) {
        const acc = await tx.account.findFirst({
          where: { id: body.disbursementAccountId, userId },
          select: { id: true },
        });
        if (!acc) throw Errors.badRequest('Conta de liberação inválida');
      }

      const loan = await tx.loan.create({
        data: {
          userId,
          lender: body.lender,
          principal: numToBig(body.principal),
          monthlyRate,
          installmentsCount: body.installments,
          firstDueDate: isoToDbDate(body.firstDueDate),
          system: body.system,
          notes: body.notes,
          disbursementAccountId: body.disbursementAccountId ?? null,
          categoryId: body.categoryId ?? null,
        },
      });

      await tx.loanInstallment.createMany({
        data: schedule.rows.map((r) => ({
          loanId: loan.id,
          number: r.number,
          dueDate: isoToDbDate(r.dueDate),
          interest: numToBig(r.interest),
          principal: numToBig(r.principal),
          amount: numToBig(r.payment),
          balanceAfter: numToBig(r.balanceAfter),
        })),
      });

      // parcelas como lançamentos agendados (LOAN_INSTALLMENT)
      const installments = await tx.loanInstallment.findMany({
        where: { loanId: loan.id },
        orderBy: { number: 'asc' },
      });
      const today = todaySP();
      for (const inst of installments) {
        await tx.transaction.create({
          data: {
            userId,
            type: 'LOAN_INSTALLMENT',
            amount: inst.amount,
            description: `${body.lender} — parcela ${inst.number}/${body.installments}`,
            competenceDate: inst.dueDate,
            dueDate: inst.dueDate,
            status: dbDateToIso(inst.dueDate) > today ? 'SCHEDULED' : 'PENDING',
            accountId: body.disbursementAccountId ?? null,
            categoryId: body.categoryId ?? null,
            loanId: loan.id,
            loanInstallmentId: inst.id,
          },
        });
      }

      // crédito do valor liberado
      if (body.disbursementAccountId) {
        await tx.transaction.create({
          data: {
            userId,
            type: 'LOAN_DISBURSEMENT',
            amount: numToBig(body.principal),
            description: `${body.lender} — valor liberado`,
            competenceDate: isoToDbDate(body.disbursementDate ?? todaySP()),
            dueDate: isoToDbDate(body.disbursementDate ?? todaySP()),
            paidDate: isoToDbDate(body.disbursementDate ?? todaySP()),
            status: 'PAID',
            accountId: body.disbursementAccountId,
            loanId: loan.id,
          },
        });
      }

      const full = await tx.loan.findUniqueOrThrow({
        where: { id: loan.id },
        include: LoansService.installmentInclude,
      });
      return this.present(full, true);
    });
  }

  async payInstallment(
    scope: { userId?: string },
    loanId: string,
    number: number,
    body: { accountId: string; paidDate: string },
  ) {
    return this.db.$transaction(async (tx) => {
      const inst = await tx.loanInstallment.findFirst({
        where: {
          loanId,
          number,
          loan: { ...(scope.userId ? { userId: scope.userId } : {}) },
        },
        include: { payment: true, loan: { select: { userId: true } } },
      });
      if (!inst) throw Errors.notFound('Parcela');
      if (!inst.payment) throw Errors.badRequest('Parcela sem lançamento associado');
      const ownerId = inst.loan.userId;

      const acc = await tx.account.findFirst({
        where: { id: body.accountId, userId: ownerId },
        select: { id: true },
      });
      if (!acc) throw Errors.badRequest('Conta inválida');

      await tx.transaction.update({
        where: { id: inst.payment.id },
        data: { status: 'PAID', paidDate: isoToDbDate(body.paidDate), accountId: body.accountId },
      });

      await this.maybeSettle(tx, loanId);
      return this.get({ userId: ownerId }, loanId);
    });
  }

  async settle(scope: { userId?: string }, id: string, body: SettleLoanBody) {
    return this.db.$transaction(async (tx) => {
      const loan = await tx.loan.findFirst({
        where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
        include: { installments: { include: { payment: true } } },
      });
      if (!loan) throw Errors.notFound('Empréstimo');
      const userId = loan.userId;

      const acc = await tx.account.findFirst({ where: { id: body.accountId, userId }, select: { id: true } });
      if (!acc) throw Errors.badRequest('Conta inválida');

      const pending = loan.installments.filter(
        (i: any) => !i.payment || i.payment.status !== 'PAID',
      );
      const outstanding = pending.reduce((s: number, i: any) => s + nb(i.amount), 0);
      const amount = body.amount ?? outstanding;

      // cancela parcelas futuras e cria 1 lançamento de quitação
      for (const i of pending) {
        if (i.payment) await tx.transaction.update({ where: { id: i.payment.id }, data: { status: 'CANCELED' } });
      }
      await tx.transaction.create({
        data: {
          userId,
          type: 'LOAN_INSTALLMENT',
          amount: numToBig(amount),
          description: `${loan.lender} — quitação antecipada`,
          competenceDate: isoToDbDate(body.settlementDate),
          dueDate: isoToDbDate(body.settlementDate),
          paidDate: isoToDbDate(body.settlementDate),
          status: 'PAID',
          accountId: body.accountId,
          loanId: loan.id,
        },
      });
      await tx.loan.update({ where: { id }, data: { status: 'SETTLED' } });
      return this.get({ userId }, id);
    });
  }

  async remove(scope: { userId?: string }, id: string) {
    const loan = await this.db.loan.findFirst({
      where: { id, ...(scope.userId ? { userId: scope.userId } : {}) },
      select: { id: true },
    });
    if (!loan) throw Errors.notFound('Empréstimo');
    await this.db.loan.delete({ where: { id } }); // cascade nas parcelas e lançamentos
    return { deleted: true };
  }

  private async maybeSettle(tx: any, loanId: string) {
    const remaining = await tx.transaction.count({
      where: { loanId, type: 'LOAN_INSTALLMENT', status: { in: ['PENDING', 'SCHEDULED'] } },
    });
    if (remaining === 0) await tx.loan.update({ where: { id: loanId }, data: { status: 'SETTLED' } });
  }

  private present(loan: any, withSchedule: boolean) {
    const installments = (loan.installments ?? []) as any[];
    const isPaid = (i: any) => i.payment?.status === 'PAID';
    const paidInstallments = installments.filter(isPaid).length;
    const totalInterest = installments.reduce((s, i) => s + nb(i.interest), 0);
    const totalPaid = installments.filter(isPaid).reduce((s, i) => s + nb(i.amount), 0);
    const outstanding = installments.filter((i) => !isPaid(i)).reduce((s, i) => s + nb(i.amount), 0);

    return {
      id: loan.id,
      lender: loan.lender,
      principal: nb(loan.principal),
      monthlyInterestPercent: Number((loan.monthlyRate * 100).toFixed(4)),
      installments: loan.installmentsCount,
      firstDueDate: dbDateToIso(loan.firstDueDate),
      system: loan.system,
      status: loan.status,
      notes: loan.notes,
      createdAt: loan.createdAt.toISOString(),
      totalInterest,
      totalPaid,
      outstandingBalance: outstanding,
      paidInstallments,
      ...(withSchedule
        ? {
            schedule: installments.map((i) => ({
              id: i.id,
              number: i.number,
              dueDate: dbDateToIso(i.dueDate),
              interest: nb(i.interest),
              principal: nb(i.principal),
              amount: nb(i.amount),
              balanceAfter: nb(i.balanceAfter),
              paidTransactionId: i.payment?.status === 'PAID' ? i.payment.id : null,
              paid: i.payment?.status === 'PAID',
            })),
          }
        : {}),
    };
  }
}
