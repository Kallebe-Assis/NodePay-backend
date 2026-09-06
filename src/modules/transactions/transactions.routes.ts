import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  bulkPayBodySchema,
  bulkPayResponseSchema,
  createTransactionBodySchema,
  importCommitResponseSchema,
  importPreviewBodySchema,
  importPreviewResponseSchema,
  listTransactionsQuerySchema,
  markPaidBodySchema,
  transactionListTotalsSchema,
  transactionSchema,
  updateTransactionBodySchema,
} from '@nodepay/shared';
import { TransactionsService } from './transactions.service.js';
import { commitImport, importTemplateCsv, previewImport } from './import.service.js';
import { ownerFilter, targetOwnerId } from '../../lib/scope.js';

const createResultSchema = z.object({
  created: z.number().int(),
  recurrenceId: z.string().optional(),
  installmentGroupId: z.string().optional(),
  transactions: z.array(transactionSchema),
});

/** Rotas de **lançamentos**: criar (conta/cartão/transferência), listar, editar,
 *  marcar pago/não pago e excluir. */
export async function transactionRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.authenticate);
  const svc = () => new TransactionsService(app.db());

  app.get(
    '/',
    {
      schema: {
        tags: ['transactions'],
        querystring: listTransactionsQuerySchema,
        response: {
          200: z.object({
            data: z.array(transactionSchema),
            page: z.number().int(),
            pageSize: z.number().int(),
            total: z.number().int(),
            totals: transactionListTotalsSchema,
          }),
        },
      },
    },
    (req) => svc().list(ownerFilter(req, req.query.userId), req.query),
  );

  app.get(
    '/:id',
    { schema: { tags: ['transactions'], params: z.object({ id: z.string() }), response: { 200: transactionSchema } } },
    (req) => svc().get(ownerFilter(req), req.params.id),
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['transactions'],
        querystring: z.object({ userId: z.string().optional() }),
        body: createTransactionBodySchema,
        response: { 201: createResultSchema },
      },
    },
    async (req, reply) =>
      reply.code(201).send(await svc().create(targetOwnerId(req, req.query.userId), req.body)),
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['transactions'],
        params: z.object({ id: z.string() }),
        body: updateTransactionBodySchema,
        response: { 200: transactionSchema },
      },
    },
    (req) => svc().update(ownerFilter(req), req.params.id, req.body),
  );

  app.post(
    '/:id/pay',
    {
      schema: {
        tags: ['transactions'],
        params: z.object({ id: z.string() }),
        body: markPaidBodySchema,
        response: { 200: transactionSchema },
      },
    },
    (req) => svc().markPaid(ownerFilter(req), req.params.id, req.body),
  );

  app.post(
    '/:id/unpay',
    { schema: { tags: ['transactions'], params: z.object({ id: z.string() }), response: { 200: transactionSchema } } },
    (req) => svc().markUnpaid(ownerFilter(req), req.params.id),
  );

  app.post(
    '/:id/skip',
    { schema: { tags: ['transactions'], params: z.object({ id: z.string() }), response: { 200: transactionSchema } } },
    (req) => svc().skip(ownerFilter(req), req.params.id),
  );

  app.post(
    '/bulk-pay',
    { schema: { tags: ['transactions'], body: bulkPayBodySchema, response: { 200: bulkPayResponseSchema } } },
    (req) => svc().bulkPay(ownerFilter(req), req.body.ids, req.body.paidDate),
  );

  // Exporta os lançamentos que casam com os MESMOS filtros da listagem, em CSV.
  app.get(
    '/export',
    { schema: { tags: ['transactions'], querystring: listTransactionsQuerySchema } },
    async (req, reply) => {
      const csv = await svc().exportCsv(ownerFilter(req, req.query.userId), req.query);
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="lancamentos.csv"')
        .send(csv);
    },
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: ['transactions'],
        params: z.object({ id: z.string() }),
        querystring: z.object({ scope: z.enum(['one', 'group']).default('one') }),
      },
    },
    (req) => svc().remove(ownerFilter(req), req.params.id, req.query.scope),
  );

  // ---- Importação em massa por CSV (limite 50) ----
  app.get('/import/template', { schema: { tags: ['transactions'] } }, async (_req, reply) => {
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="modelo-lancamentos.csv"')
      .send(importTemplateCsv());
  });

  app.post(
    '/import/preview',
    {
      schema: {
        tags: ['transactions'],
        body: importPreviewBodySchema,
        response: { 200: importPreviewResponseSchema },
      },
    },
    (req) => previewImport(app.db(), targetOwnerId(req), req.body.csv),
  );

  app.post(
    '/import/commit',
    {
      schema: {
        tags: ['transactions'],
        body: importPreviewBodySchema,
        response: { 200: importCommitResponseSchema },
      },
    },
    (req) => commitImport(app.db(), targetOwnerId(req), req.body.csv),
  );
}
