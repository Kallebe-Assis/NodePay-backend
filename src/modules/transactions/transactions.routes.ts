import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createTransactionBodySchema,
  listTransactionsQuerySchema,
  markPaidBodySchema,
  transactionSchema,
  updateTransactionBodySchema,
} from '@nodepay/shared';
import { TransactionsService } from './transactions.service.js';
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
}
