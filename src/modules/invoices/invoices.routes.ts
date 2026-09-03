import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { invoiceSchema, payInvoiceBodySchema } from '@nodepay/shared';
import { InvoicesService } from './invoices.service.js';
import { ownerFilter } from '../../lib/scope.js';

/** Rotas de **faturas** de cartão: listar, fechar e pagar (gera lançamento na conta). */
export async function invoiceRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.authenticate);
  const svc = () => new InvoicesService(app.db());

  app.get(
    '/',
    {
      schema: {
        tags: ['invoices'],
        querystring: z.object({
          creditCardId: z.string().optional(),
          status: z.enum(['OPEN', 'CLOSED', 'PAID']).optional(),
          userId: z.string().optional(),
        }),
        response: { 200: z.array(invoiceSchema) },
      },
    },
    (req) => svc().list(ownerFilter(req, req.query.userId), req.query),
  );

  app.get(
    '/:id',
    { schema: { tags: ['invoices'], params: z.object({ id: z.string() }) } },
    (req) => svc().get(ownerFilter(req), req.params.id),
  );

  app.post(
    '/:id/close',
    { schema: { tags: ['invoices'], params: z.object({ id: z.string() }), response: { 200: invoiceSchema } } },
    (req) => svc().close(ownerFilter(req), req.params.id),
  );

  app.post(
    '/:id/pay',
    {
      schema: {
        tags: ['invoices'],
        params: z.object({ id: z.string() }),
        body: payInvoiceBodySchema,
        response: { 200: invoiceSchema },
      },
    },
    (req) => svc().pay(ownerFilter(req), req.params.id, req.body),
  );
}
