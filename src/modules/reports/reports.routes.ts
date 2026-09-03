import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  chartsQuerySchema,
  chartsResponseSchema,
  deliverReportBodySchema,
  deliverReportResponseSchema,
  generateReportQuerySchema,
} from '@nodepay/shared';
import { ReportsService } from './reports.service.js';
import { ChartsService } from './charts.service.js';
import { deliverDocument } from '../telegram/telegram.service.js';
import { ownerFilter, targetOwnerId } from '../../lib/scope.js';

/**
 * Rotas do domínio **relatórios**: dados para os gráficos, download de arquivo
 * (CSV/PDF) e envio do arquivo pelo bot do Telegram.
 */
export async function reportRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  // Toda rota de relatório exige usuário autenticado.
  app.addHook('preHandler', app.authenticate);

  // ---- GET /charts — séries prontas para os gráficos da aba "Gráficos" ----
  app.get(
    '/charts',
    {
      schema: {
        tags: ['reports'],
        querystring: chartsQuerySchema,
        response: { 200: chartsResponseSchema },
      },
    },
    (req) =>
      new ChartsService(app.db()).build(
        ownerFilter(req, req.query.userId),
        req.query.from,
        req.query.to,
      ),
  );

  // ---- GET /generate — gera o relatório e devolve o arquivo para download ----
  app.get(
    '/generate',
    { schema: { tags: ['reports'], querystring: generateReportQuerySchema } },
    async (req, reply) => {
      const ownerId = targetOwnerId(req, req.query.userId);
      const report = await new ReportsService(app.db()).generate(ownerId, req.query);

      reply
        .header('Content-Type', report.contentType)
        .header('Content-Disposition', `attachment; filename="${report.filename}"`)
        .send(report.body);
    },
  );

  // ---- POST /telegram — gera o mesmo relatório e envia pelo bot do Telegram ----
  // Diferente do /generate, aqui o erro de entrega (chat não vinculado, token
  // ausente, etc.) sobe como 400 para o usuário ver o motivo.
  app.post(
    '/telegram',
    {
      schema: {
        tags: ['reports'],
        body: deliverReportBodySchema,
        response: { 200: deliverReportResponseSchema },
      },
    },
    async (req) => {
      const ownerId = targetOwnerId(req, req.body.userId);
      const report = await new ReportsService(app.db()).generate(ownerId, req.body);
      await deliverDocument(app.db(), ownerId, report);
      return { delivered: true as const, filename: report.filename };
    },
  );
}
