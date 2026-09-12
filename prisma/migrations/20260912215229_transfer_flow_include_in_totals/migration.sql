-- CreateEnum
CREATE TYPE "TransferFlow" AS ENUM ('INCOME', 'EXPENSE');

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "includeInTotals" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "transferFlow" "TransferFlow";
