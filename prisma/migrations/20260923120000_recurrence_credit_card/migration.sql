-- recurrences: séries FIXAS (mensal/semanal) agora também podem ser compras no
-- cartão — guarda em qual cartão (nulo = série em conta, como sempre foi).
ALTER TABLE "recurrences" ADD COLUMN "creditCardId" TEXT;
