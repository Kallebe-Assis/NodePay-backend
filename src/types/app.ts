import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

/**
 * Instância Fastify já com o type provider do Zod aplicado.
 * Use este tipo nos módulos de rota para que `schema: { body, querystring,
 * response }` seja validado contra os schemas Zod compartilhados.
 */
export type AppInstance = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  FastifyBaseLogger,
  ZodTypeProvider
>;
