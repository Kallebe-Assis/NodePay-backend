-- Pagamento parcial: novo status PARTIAL + coluna paidAmount (centavos já liquidados).
-- O valor da nova enum não é usado nesta mesma migração, então roda sem erro no PG 12+.

-- AlterEnum
ALTER TYPE "TransactionStatus" ADD VALUE 'PARTIAL';

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "paidAmount" BIGINT NOT NULL DEFAULT 0;
