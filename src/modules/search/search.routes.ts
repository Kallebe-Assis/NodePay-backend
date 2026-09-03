import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { searchQuerySchema, searchResponseSchema } from '@nodepay/shared';
import { nb } from '../../lib/money.js';
import { dbDateToIso } from '../../lib/date.js';
import { ownerFilter } from '../../lib/scope.js';

const money = (c: number) =>
  (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Busca global (paleta de comandos): lançamentos, contas, cartões, categorias. */
export async function searchRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/',
    {
      schema: {
        tags: ['search'],
        querystring: searchQuerySchema,
        response: { 200: searchResponseSchema },
      },
    },
    async (req) => {
      const db = app.db();
      const scope = ownerFilter(req, req.query.userId);
      const owner = scope.userId ? { userId: scope.userId } : {};
      const q = req.query.q.trim();
      const like = { contains: q, mode: 'insensitive' as const };

      const [transactions, accounts, cards, categories] = await Promise.all([
        db.transaction.findMany({
          where: { ...owner, description: like, type: { not: 'TRANSFER' } },
          orderBy: { competenceDate: 'desc' },
          take: 6,
          select: { id: true, description: true, amount: true, type: true, competenceDate: true },
        }),
        db.account.findMany({
          where: { ...owner, name: like },
          take: 5,
          select: { id: true, name: true, type: true },
        }),
        db.creditCard.findMany({
          where: { ...owner, name: like },
          take: 5,
          select: { id: true, name: true, lastDigits: true },
        }),
        db.category.findMany({
          where: { ...owner, name: like },
          take: 5,
          select: { id: true, name: true, kind: true },
        }),
      ]);

      return {
        transactions: transactions.map((t) => ({
          id: t.id,
          label: t.description,
          sub: `${dbDateToIso(t.competenceDate)} · ${money(nb(t.amount))}`,
        })),
        accounts: accounts.map((a) => ({ id: a.id, label: a.name, sub: a.type })),
        cards: cards.map((c) => ({
          id: c.id,
          label: c.name,
          sub: c.lastDigits ? `final ${c.lastDigits}` : null,
        })),
        categories: categories.map((c) => ({
          id: c.id,
          label: c.name,
          sub: c.kind === 'INCOME' ? 'Receita' : 'Despesa',
        })),
      };
    },
  );
}
