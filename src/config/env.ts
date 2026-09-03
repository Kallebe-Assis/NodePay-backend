import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { booleanish } from '@nodepay/shared';

// Carrega backend/.env antes de qualquer leitura de process.env.
loadDotenv();

/**
 * Validação do ambiente. Roda uma vez no boot; se faltar algo essencial,
 * a API não sobe (fail fast).
 *
 * Enquanto o banco não existe, DATABASE_URL pode ficar vazio: a API sobe em
 * "modo degradado" (rotas de saúde funcionam, rotas que usam o banco retornam
 * 503). Assim dá pra desenvolver o front antes do Postgres.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TZ: z.string().default('America/Sao_Paulo'),

  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().default(3333),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().default(''),

  JWT_ACCESS_SECRET: z.string().min(16).default('dev-only-access-secret-change-me!!'),
  JWT_REFRESH_SECRET: z.string().min(16).default('dev-only-refresh-secret-change-me!'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  PASSWORD_HASH_MEMORY_KIB: z.coerce.number().int().default(19456),
  PASSWORD_HASH_TIME_COST: z.coerce.number().int().default(2),

  JOBS_ENABLED: booleanish(false),
  PGBOSS_SCHEMA: z.string().default('pgboss'),

  PUPPETEER_EXECUTABLE_PATH: z.string().optional(),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_ENABLED: booleanish(false),

  BACKUP_ENABLED: booleanish(false),
  B2_S3_ENDPOINT: z.string().optional(),
  B2_REGION: z.string().optional(),
  B2_BUCKET: z.string().optional(),
  B2_KEY_ID: z.string().optional(),
  B2_APP_KEY: z.string().optional(),
  SECRETS_ENCRYPTION_KEY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`❌ Variaveis de ambiente invalidas:\n${issues}`);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  // Plataformas de deploy (Render, Railway, Fly, Heroku…) injetam a porta em
  // `PORT` dinamicamente e esperam que o app escute nela. `PORT` tem prioridade
  // sobre `API_PORT`.
  API_PORT: process.env.PORT ? Number(process.env.PORT) : parsed.data.API_PORT,
};
export const isDbConfigured = env.DATABASE_URL.trim().length > 0;
export const isProd = env.NODE_ENV === 'production';
