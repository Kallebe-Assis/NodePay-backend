import type { PrismaClient } from '@prisma/client';
import {
  addDays,
  formatBRL,
  formatShortDate,
  type Notification,
  nowSP,
  OUTFLOW_TYPES,
  todaySP,
} from '@nodepay/shared';
import { nb } from '../../lib/money.js';
import { dbDateToIso, isoToDbDate } from '../../lib/date.js';
import { computeBalances } from '../accounts/balance.js';
import { recordGoalOutcomes } from '../goals/outcomes.js';
import { computeWeeklySummary } from './weekly-summary.js';

/** channel = "off" | "system" | "telegram" | "both" — inclui o app quando "system"/"both". */
function includesSystem(channel: string | undefined | null): boolean {
  return channel === 'system' || channel === 'both';
}

/**
 * Notificações são CALCULADAS na hora (não há tabela). O "lido" é controlado no
 * cliente por id determinístico. Respeita as preferências em UserSettings.
 */
export class NotificationsService {
  constructor(private readonly db: PrismaClient) {}

  async list(userId: string, isAdmin: boolean): Promise<{ items: Notification[]; unread: number }> {
    const settings = await this.db.userSettings.findUnique({ where: { userId } });
    const p = {
      billsDue: includesSystem(settings?.notifyBillsDueChannel ?? 'system'),
      invoiceClosing: includesSystem(settings?.notifyInvoiceClosingChannel ?? 'system'),
      lowBalance: includesSystem(settings?.notifyLowBalanceChannel ?? 'system'),
      weeklySummary: includesSystem(settings?.notifyWeeklySummaryChannel ?? 'off'),
      weeklySummaryDay: settings?.weeklySummaryDay ?? 1,
      pendingUsers: settings?.notifyPendingUsers ?? true,
      threshold: settings ? nb(settings.lowBalanceThreshold) : 0,
    };

    const today = todaySP();
    const items: Notification[] = [];
    // 0=domingo … 6=sábado (Luxon: segunda=1…domingo=7)
    const todayWeekday = nowSP().weekday % 7;
    const showWeeklySummary = p.weeklySummary && todayWeekday === p.weeklySummaryDay;

    // Dispara em paralelo tudo que é independente (antes era em série — cada
    // ida ao banco fora da máquina somava latência).
    const [bills, invoices, balances, outcomes, pendingCount, weekly] = await Promise.all([
      p.billsDue
        ? this.db.transaction.findMany({
            where: {
              userId,
              type: { in: OUTFLOW_TYPES },
              status: { in: ['PENDING', 'SCHEDULED'] },
              dueDate: { lte: isoToDbDate(addDays(today, 7)) },
            },
            orderBy: { dueDate: 'asc' },
            take: 20,
            include: { category: { select: { name: true } } },
          })
        : Promise.resolve([]),
      p.invoiceClosing
        ? this.db.invoice.findMany({
            where: { userId, status: 'OPEN', closingDate: { lte: isoToDbDate(addDays(today, 3)) } },
            include: { creditCard: { select: { name: true } } },
            orderBy: { closingDate: 'asc' },
          })
        : Promise.resolve([]),
      p.lowBalance && p.threshold > 0
        ? computeBalances(this.db, { userId })
        : Promise.resolve(null),
      recordGoalOutcomes(this.db, userId).catch(() => []),
      isAdmin && p.pendingUsers
        ? this.db.user.count({ where: { status: 'PENDING' } })
        : Promise.resolve(0),
      showWeeklySummary ? computeWeeklySummary(this.db, userId) : Promise.resolve(null),
    ]);

    // ---- contas a vencer / vencidas (próx. 7 dias) ----
    {
      for (const b of bills) {
        const due = dbDateToIso(b.dueDate);
        const overdue = due < today;
        items.push({
          id: `bill_due:${b.id}`,
          kind: 'bill_due',
          severity: overdue ? 'danger' : 'warning',
          title: overdue ? 'Conta vencida' : 'Conta a vencer',
          body: `${b.description} — ${formatShortDate(due)}`,
          date: due,
          amount: nb(b.amount),
          href: '/transactions',
        });
      }
    }

    // ---- faturas fechando (próx. 3 dias) ----
    for (const inv of invoices) {
      items.push({
        id: `invoice_closing:${inv.id}`,
        kind: 'invoice_closing',
        severity: 'info',
        title: 'Fatura fechando',
        body: `${inv.creditCard.name} fecha em ${formatShortDate(dbDateToIso(inv.closingDate))}`,
        date: dbDateToIso(inv.closingDate),
        amount: nb(inv.total),
        href: '/credit-cards',
      });
    }

    // ---- saldo projetado baixo ----
    if (balances) {
      const totalProjected = [...balances.values()].reduce((s, b) => s + b.projectedBalance, 0);
      if (totalProjected < p.threshold) {
        items.push({
          id: `low_balance:${today}`,
          kind: 'low_balance',
          severity: 'danger',
          title: 'Saldo projetado baixo',
          body: `Projeção de ${formatShortDate(today)}: abaixo do limite definido`,
          date: today,
          amount: totalProjected,
          href: '/',
        });
      }
    }

    // ---- objetivos: só conferidos no mês SEGUINTE ao período do objetivo ----
    for (const o of outcomes) {
      if (!o.notifySystem) continue;
      if (o.achieved) {
        items.push({
          id: `goal_achieved:${o.goalId}:${o.period}`,
          kind: 'goal_achieved',
          severity: 'info',
          title: 'Objetivo conquistado 🎯',
          body: `${o.title} — ${o.period}`,
          date: o.progress.periodEnd,
          amount: o.progress.current,
          href: '/goals?view=trophies',
        });
      } else {
        items.push({
          id: `goal_missed:${o.goalId}:${o.period}`,
          kind: 'goal_missed',
          severity: 'warning',
          title: 'Objetivo não atingido',
          body: `${o.title} — ${o.period}`,
          date: o.progress.periodEnd,
          amount: o.progress.current,
          href: '/goals',
        });
      }
    }

    // ---- resumo semanal (só no dia da semana configurado) ----
    if (weekly) {
      items.push({
        id: `weekly_summary:${today}`,
        kind: 'weekly_summary',
        severity: weekly.net < 0 ? 'warning' : 'info',
        title: 'Resumo da semana',
        body: `Receitas ${formatBRL(weekly.income)} · Despesas ${formatBRL(weekly.expense)} · Resultado ${formatBRL(weekly.net)}${weekly.topCategory ? ` · Maior gasto: ${weekly.topCategory.name}` : ''}`,
        date: today,
        amount: weekly.net,
        href: '/',
      });
    }

    // ---- (admin) usuários aguardando aprovação ----
    {
      const pending = pendingCount;
      if (pending > 0) {
        items.push({
          id: `pending_user:count:${pending}`,
          kind: 'pending_user',
          severity: 'warning',
          title: 'Cadastros aguardando aprovação',
          body: `${pending} usuário(s) pendente(s)`,
          date: null,
          amount: null,
          href: '/settings?tab=users',
        });
      }
    }

    return { items, unread: items.length };
  }
}
