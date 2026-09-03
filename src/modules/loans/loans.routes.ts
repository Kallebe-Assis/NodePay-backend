import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createLoanBodySchema,
  isoDateSchema,
  loanSchema,
  settleLoanBodySchema,
} from '@nodepay/shared';
import { LoansService } from './loans.service.js';
import { ownerFilter, targetOwnerId } from '../../lib/scope.js';

/** Rotas de **empréstimos**: CRUD, tabela de amortização (Price/SAC), pagar parcela e quitar. */
export async function loanRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.authenticate);
  const svc = () => new LoansService(app.db());

  app.get(
    '/',
    {
      schema: {
        tags: ['loans'],
        querystring: z.object({ userId: z.string().optional() }),
        response: { 200: z.array(loanSchema) },
      },
    },
    (req) => svc().list(ownerFilter(req, req.query.userId)),
  );

  app.get(
    '/:id',
    { schema: { tags: ['loans'], params: z.object({ id: z.string() }), response: { 200: loanSchema } } },
    (req) => svc().get(ownerFilter(req), req.params.id),
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['loans'],
        querystring: z.object({ userId: z.string().optional() }),
        body: createLoanBodySchema,
        response: { 201: loanSchema },
      },
    },
    async (req, reply) =>
      reply.code(201).send(await svc().create(targetOwnerId(req, req.query.userId), req.body)),
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['loans'],
        params: z.object({ id: z.string() }),
        body: z.object({ lender: z.string().min(1).max(120).optional(), notes: z.string().max(500).nullable().optional() }),
        response: { 200: loanSchema },
      },
    },
    (req) => svc().update(ownerFilter(req), req.params.id, req.body),
  );

  app.post(
    '/:id/installments/:number/pay',
    {
      schema: {
        tags: ['loans'],
        params: z.object({ id: z.string(), number: z.coerce.number().int() }),
        body: z.object({ accountId: z.string(), paidDate: isoDateSchema }),
        response: { 200: loanSchema },
      },
    },
    (req) => svc().payInstallment(ownerFilter(req), req.params.id, req.params.number, req.body),
  );

  app.post(
    '/:id/settle',
    {
      schema: {
        tags: ['loans'],
        params: z.object({ id: z.string() }),
        body: settleLoanBodySchema,
        response: { 200: loanSchema },
      },
    },
    (req) => svc().settle(ownerFilter(req), req.params.id, req.body),
  );

  app.delete(
    '/:id',
    { schema: { tags: ['loans'], params: z.object({ id: z.string() }) } },
    (req) => svc().remove(ownerFilter(req), req.params.id),
  );
}
