-- user_settings: "cadastros pendentes" (admin) agora usa canal
-- (off|system|telegram|both) igual aos demais tipos de notificação, em vez
-- de um simples liga/desliga — migra o boolean antigo preservando o valor.
ALTER TABLE "user_settings"
  ADD COLUMN "notifyPendingUsersChannel" TEXT NOT NULL DEFAULT 'system';

UPDATE "user_settings" SET
  "notifyPendingUsersChannel" = CASE WHEN "notifyPendingUsers" THEN 'system' ELSE 'off' END;

ALTER TABLE "user_settings"
  DROP COLUMN "notifyPendingUsers";
