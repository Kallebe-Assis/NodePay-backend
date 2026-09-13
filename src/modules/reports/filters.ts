import type { Prisma, TransactionType } from '@prisma/client';
import type { ReportFlow } from '@nodepay/shared';

/** Tipos de lançamento que cada grupo do filtro "flows" cobre. */
export const FLOW_TYPES: Record<ReportFlow, TransactionType[]> = {
  income: ['INCOME', 'LOAN_DISBURSEMENT'],
  expense: ['EXPENSE', 'LOAN_INSTALLMENT', 'INVOICE_PAYMENT'],
  card: ['CARD_EXPENSE'],
  transfer: ['TRANSFER'],
};

/**
 * Monta o `where` comum de contas/cartões/grupos — usado tanto no "Gerar
 * relatório" quanto nos "Gráficos" (mesmo filtro nos dois lugares).
 *
 * Conta e cartão combinam em OU (mostra o que bater com QUALQUER um dos
 * dois), nunca em E: um lançamento normalmente só tem accountId OU
 * creditCardId preenchido, então exigir os dois ao mesmo tempo sempre
 * devolveria zero linhas.
 */
export function accountCardFlowWhere(q: {
  accountIds?: string[];
  creditCardIds?: string[];
  flows?: ReportFlow[];
}): Prisma.TransactionWhereInput {
  const hasAcc = !!q.accountIds?.length;
  const hasCard = !!q.creditCardIds?.length;
  const scopeWhere: Prisma.TransactionWhereInput =
    hasAcc && hasCard
      ? { OR: [{ accountId: { in: q.accountIds } }, { creditCardId: { in: q.creditCardIds } }] }
      : hasAcc
        ? { accountId: { in: q.accountIds } }
        : hasCard
          ? { creditCardId: { in: q.creditCardIds } }
          : {};
  return {
    ...scopeWhere,
    ...(q.flows ? { type: { in: q.flows.flatMap((f) => FLOW_TYPES[f]) } } : {}),
  };
}
