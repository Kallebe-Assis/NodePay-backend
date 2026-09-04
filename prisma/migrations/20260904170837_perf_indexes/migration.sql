-- Índices de performance para as consultas que somam o histórico de
-- lançamentos (computeBalances, netWorth) e o agrupamento por recorrência.
-- Só CREATE INDEX — nenhuma coluna/dado é alterado.

-- CreateIndex
CREATE INDEX "transactions_userId_paidDate_idx" ON "transactions"("userId", "paidDate");

-- CreateIndex
CREATE INDEX "transactions_transferToAccountId_paidDate_idx" ON "transactions"("transferToAccountId", "paidDate");

-- CreateIndex
CREATE INDEX "transactions_recurrenceId_idx" ON "transactions"("recurrenceId");
