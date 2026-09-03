import type { PrismaClient } from '@prisma/client';
import type { GoalProgress } from '@nodepay/shared';
import { evaluateGoal, lastCompletedPeriod } from './goal.eval.js';

export interface GoalOutcome {
  goalId: string;
  title: string;
  period: string;
  achieved: boolean;
  progress: GoalProgress;
  notifyTelegram: boolean;
  notifySystem: boolean;
  /** true na primeira vez que este período encerrado é observado */
  firstObservation: boolean;
}

/**
 * Confere o ÚLTIMO MÊS ENCERRADO de cada objetivo ativo de um usuário.
 * Registra a conquista (`timesAchieved` / `lastAchievedPeriod`) uma única vez
 * por período. Retorna os desfechos para montar notificações / enviar Telegram.
 */
export async function recordGoalOutcomes(
  db: PrismaClient,
  userId: string,
): Promise<GoalOutcome[]> {
  const goals = await db.goal.findMany({ where: { userId, active: true } });
  const out: GoalOutcome[] = [];

  for (const g of goals) {
    const period = lastCompletedPeriod(g);
    if (!period) continue;

    const progress = await evaluateGoal(db, userId, g, period).catch(() => null);
    if (!progress) continue;

    const already = g.lastAchievedPeriod === period || g.lastNotifiedPeriod === period;
    if (progress.achieved && g.lastAchievedPeriod !== period) {
      await db.goal.update({
        where: { id: g.id },
        data: { timesAchieved: { increment: 1 }, lastAchievedPeriod: period },
      });
    }

    out.push({
      goalId: g.id,
      title: g.title,
      period,
      achieved: progress.achieved,
      progress,
      notifyTelegram: g.notifyTelegram,
      notifySystem: g.notifySystem,
      firstObservation: !already,
    });
  }
  return out;
}
