import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  settingsSchema,
  telegramTestBodySchema,
  telegramTestResponseSchema,
  updateSettingsBodySchema,
} from '@nodepay/shared';
import { SettingsService } from './settings.service.js';
import { runBackup } from '../backup/backup.service.js';
import { sendTestMessage } from '../telegram/telegram.service.js';

/** Rotas de **configurações** do usuário: ler/gravar prefs, backup, Telegram. */
export async function settingsRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.authenticate);
  const svc = () => new SettingsService(app.db());

  app.get(
    '/',
    { schema: { tags: ['settings'], response: { 200: settingsSchema } } },
    (req) => svc().get(req.userId),
  );

  app.patch(
    '/',
    { schema: { tags: ['settings'], body: updateSettingsBodySchema, response: { 200: settingsSchema } } },
    (req) => svc().update(req.userId, req.body),
  );

  app.post(
    '/telegram/link-token',
    { schema: { tags: ['settings'], response: { 200: z.object({ linkToken: z.string() }) } } },
    (req) => svc().createTelegramLinkToken(req.userId),
  );

  app.post(
    '/telegram/test',
    {
      schema: {
        tags: ['settings'],
        body: telegramTestBodySchema,
        response: { 200: telegramTestResponseSchema },
      },
    },
    async (req) => {
      await sendTestMessage(app.db(), req.userId, req.body);
      return { ok: true as const };
    },
  );

  app.post(
    '/backup/run',
    { schema: { tags: ['settings'] } },
    (req) => runBackup(app.db(), req.userId),
  );
}
