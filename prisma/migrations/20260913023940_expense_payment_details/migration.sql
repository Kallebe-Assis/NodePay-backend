-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PIX', 'BOLETO', 'CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'BANK_TRANSFER', 'OTHER');

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "boletoLine" TEXT,
ADD COLUMN     "payeeName" TEXT,
ADD COLUMN     "paymentMethod" "PaymentMethod",
ADD COLUMN     "pixCopyPaste" TEXT;
