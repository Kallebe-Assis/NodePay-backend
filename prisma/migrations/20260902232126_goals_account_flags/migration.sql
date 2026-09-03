-- CreateEnum
CREATE TYPE "GoalType" AS ENUM ('SPEND_MAX', 'EARN_MIN', 'NET_MIN', 'END_BALANCE_MIN');

-- CreateEnum
CREATE TYPE "GoalRecurrence" AS ENUM ('ONCE', 'MONTHLY', 'N_MONTHS');

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "includeInDashboard" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "GoalType" NOT NULL,
    "targetAmount" BIGINT NOT NULL,
    "recurrence" "GoalRecurrence" NOT NULL DEFAULT 'MONTHLY',
    "monthsCount" INTEGER,
    "startMonth" DATE NOT NULL,
    "categoryId" TEXT,
    "notifySystem" BOOLEAN NOT NULL DEFAULT true,
    "notifyTelegram" BOOLEAN NOT NULL DEFAULT false,
    "notifyEmail" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastNotifiedPeriod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goals_userId_active_idx" ON "goals"("userId", "active");

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
