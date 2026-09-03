import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { AppError } from '../lib/errors.js';

/** Converte qualquer erro no envelope { error: { code, message, details } }. */
export default fp(
  async (app) => {
    app.setNotFoundHandler((req, reply) => {
      reply.status(404).send({
        error: { code: 'ROUTE_NOT_FOUND', message: `Rota ${req.method} ${req.url} não existe` },
      });
    });

    app.setErrorHandler((error, request, reply) => {
      if (error instanceof AppError) {
        return reply
          .status(error.statusCode)
          .send({ error: { code: error.code, message: error.message, details: error.details } });
      }

      if (hasZodFastifySchemaValidationErrors(error) || error instanceof ZodError) {
        const issues = error instanceof ZodError ? error.issues : (error as any).validation;
        return reply.status(422).send({
          error: { code: 'VALIDATION_ERROR', message: 'Dados inválidos', details: issues },
        });
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          return reply
            .status(409)
            .send({ error: { code: 'CONFLICT', message: 'Registro duplicado', details: error.meta } });
        }
        if (error.code === 'P2025') {
          return reply
            .status(404)
            .send({ error: { code: 'NOT_FOUND', message: 'Registro não encontrado' } });
        }
      }

      if ((error as any).code === 'DB_UNAVAILABLE') {
        return reply.status(503).send({
          error: {
            code: 'DB_UNAVAILABLE',
            message: 'Banco não configurado. Preencha DATABASE_URL no .env.',
          },
        });
      }

      request.log.error({ err: error }, 'Erro não tratado');
      // Chegou aqui = erro não-domínio (framework/lib/bug). Nunca ecoamos a
      // mensagem crua do erro (pode vazar detalhe interno) — só um texto
      // genérico por classe de status. Erros de domínio (AppError) já foram
      // tratados acima com mensagem segura e intencional.
      const status = (error as { statusCode?: number }).statusCode ?? 500;
      const generic =
        status >= 500
          ? 'Erro interno'
          : status === 429
            ? 'Muitas requisições. Tente de novo em instantes.'
            : 'Requisição inválida';
      return reply.status(status).send({
        error: { code: status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR', message: generic },
      });
    });
  },
  { name: 'error-handler' },
);
