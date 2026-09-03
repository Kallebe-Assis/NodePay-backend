-- AlterTable
ALTER TABLE "goals" ADD COLUMN     "lastAchievedPeriod" TEXT,
ADD COLUMN     "timesAchieved" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "remindDaysBefore" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "remindTelegram" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reminderSentAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "transactions_remindTelegram_reminderSentAt_idx" ON "transactions"("remindTelegram", "reminderSentAt");
