import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { env, isProd } from './config/env.js';
import type { AppInstance } from './types/app.js';
import prismaPlugin from './plugins/prisma.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import swaggerPlugin from './plugins/swagger.js';

import { healthRoutes } from './modules/health/health.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { userRoutes } from './modules/users/users.routes.js';
import { accountRoutes } from './modules/accounts/accounts.routes.js';
import { categoryRoutes } from './modules/categories/categories.routes.js';
import { transactionRoutes } from './modules/transactions/transactions.routes.js';
import { creditCardRoutes } from './modules/credit-cards/credit-cards.routes.js';
import { invoiceRoutes } from './modules/invoices/invoices.routes.js';
import { loanRoutes } from './modules/loans/loans.routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';
import { reportRoutes } from './modules/reports/reports.routes.js';
import { settingsRoutes } from './modules/settings/settings.routes.js';
import { notificationRoutes } from './modules/notifications/notifications.routes.js';
import { goalRoutes } from './modules/goals/goals.routes.js';
import { calendarRoutes } from './modules/calendar/calendar.routes.js';

export async function buildApp(): Promise<AppInstance> {
  const app = Fastify({
    logger: isProd
      ? { level: 'info' }
      : {
          level: 'debug',
          transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
        },
    trustProxy: true,
    ajv: { customOptions: { coerceTypes: false } },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // ---- plataforma ----
  await app.register(sensible);
  await app.register(helmet, { contentSecurityPolicy: isProd ? undefined : false });
  await app.register(cors, {
    origin: env.WEB_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(errorHandler);
  await app.register(prismaPlugin);
  await app.register(authPlugin);
  await app.register(swaggerPlugin);

  // ---- rotas ----
  await app.register(healthRoutes); // /health, /ready (probes de infra)
  await app.register(
    async (api) => {
      await api.register(healthRoutes); // /api/v1/health, /api/v1/ready (para o app)
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(userRoutes, { prefix: '/users' });
      await api.register(accountRoutes, { prefix: '/accounts' });
      await api.register(categoryRoutes, { prefix: '/categories' });
      await api.register(transactionRoutes, { prefix: '/transactions' });
      await api.register(creditCardRoutes, { prefix: '/credit-cards' });
      await api.register(invoiceRoutes, { prefix: '/invoices' });
      await api.register(loanRoutes, { prefix: '/loans' });
      await api.register(dashboardRoutes, { prefix: '/dashboard' });
      await api.register(goalRoutes, { prefix: '/goals' });
      await api.register(calendarRoutes, { prefix: '/calendar' });
      await api.register(reportRoutes, { prefix: '/reports' });
      await api.register(settingsRoutes, { prefix: '/settings' });
      await api.register(notificationRoutes, { prefix: '/notifications' });
    },
    { prefix: '/api/v1' },
  );

  return app;
}
