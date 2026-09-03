-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "lowBalanceThreshold" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "notifyBillsDue" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyInvoiceClosing" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyLowBalance" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyPendingUsers" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyWeeklySummary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "themePref" TEXT NOT NULL DEFAULT 'system';
