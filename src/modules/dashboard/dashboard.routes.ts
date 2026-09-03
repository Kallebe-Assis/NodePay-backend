import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  dashboardQuerySchema,
  dashboardSummarySchema,
  netWorthQuerySchema,
  netWorthResponseSchema,
} from '@nodepay/shared';
import { DashboardService } from './dashboard.service.js';
import { targetOwnerId } from '../../lib/scope.js';

/** Rota de **dashboard**: resumo agregado do mês (totais, saldos, cartões, breakdowns). */
export async function dashboardRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/summary',
    {
      schema: {
        tags: ['dashboard'],
        querystring: dashboardQuerySchema,
        response: { 200: dashboardSummarySchema },
      },
    },
    // admin pode informar ?userId para ver o painel de outro usuário
    (req) =>
      new DashboardService(app.db()).summary(targetOwnerId(req, req.query.userId), req.query.month),
  );

  app.get(
    '/networth',
    {
      schema: {
        tags: ['dashboard'],
        querystring: netWorthQuerySchema,
        response: { 200: netWorthResponseSchema },
      },
    },
    (req) =>
      new DashboardService(app.db()).netWorth(targetOwnerId(req, req.query.userId), req.query.months),
  );
}
