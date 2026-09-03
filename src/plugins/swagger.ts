import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import { isProd } from '../config/env.js';

/** Documentação interativa em /docs (desabilitada em produção por padrão). */
export default fp(
  async (app) => {
    if (isProd) return;

    await app.register(swagger, {
      openapi: {
        info: {
          title: 'NodePay API',
          description: 'Gestão financeira pessoal — despesas, cartão, empréstimos, relatórios.',
          version: '0.1.0',
        },
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          },
        },
      },
      transform: jsonSchemaTransform,
    });

    await app.register(swaggerUi, { routePrefix: '/docs' });
  },
  { name: 'swagger' },
);
