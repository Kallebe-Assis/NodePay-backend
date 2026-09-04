-- transactions: observações, etiquetas e local de compra (todos opcionais)
ALTER TABLE "transactions"
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "placeId" TEXT,
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- user_settings: canal (off|system|telegram|both) por tipo de notificação +
-- agendamento do resumo semanal. Migra os booleans antigos preservando o valor.
ALTER TABLE "user_settings"
  ADD COLUMN "notifyBillsDueChannel" TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN "notifyInvoiceClosingChannel" TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN "notifyLowBalanceChannel" TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN "notifyTelegramLastSentDate" TEXT,
  ADD COLUMN "notifyWeeklySummaryChannel" TEXT NOT NULL DEFAULT 'off',
  ADD COLUMN "weeklySummaryDay" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "weeklySummaryHour" INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN "weeklySummaryLastSentWeek" TEXT;

UPDATE "user_settings" SET
  "notifyBillsDueChannel" = CASE WHEN "notifyBillsDue" THEN 'system' ELSE 'off' END,
  "notifyInvoiceClosingChannel" = CASE WHEN "notifyInvoiceClosing" THEN 'system' ELSE 'off' END,
  "notifyLowBalanceChannel" = CASE WHEN "notifyLowBalance" THEN 'system' ELSE 'off' END,
  "notifyWeeklySummaryChannel" = CASE WHEN "notifyWeeklySummary" THEN 'system' ELSE 'off' END;

ALTER TABLE "user_settings"
  DROP COLUMN "notifyBillsDue",
  DROP COLUMN "notifyInvoiceClosing",
  DROP COLUMN "notifyLowBalance",
  DROP COLUMN "notifyWeeklySummary";

-- CreateTable
CREATE TABLE "places" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "icon" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "color" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "places_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "places_userId_idx" ON "places"("userId");

-- CreateIndex
CREATE INDEX "transactions_placeId_idx" ON "transactions"("placeId");

-- AddForeignKey
ALTER TABLE "places" ADD CONSTRAINT "places_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "places"("id") ON DELETE SET NULL ON UPDATE CASCADE;
