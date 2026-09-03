import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { booleanish } from '@nodepay/shared';

// Carrega backend/.env antes de qualquer leitura de process.env.
loadDotenv();

/** Defaults SÓ para desenvolvimento — rejeitados em produção (ver checkProdEnv). */
const DEV_JWT_ACCESS_SECRET = 'dev-only-access-secret-change-me!!';
const DEV_JWT_REFRESH_SECRET = 'dev-only-refresh-secret-change-me!';

/**
 * Validação do ambiente. Roda uma vez no boot; se faltar algo essencial,
 * a API não sobe (fail fast).
 *
 * Em desenvolvimento, DATABASE_URL pode ficar vazio: a API sobe em "modo
 * degradado" (rotas de saúde funcionam, rotas que usam o banco retornam 503).
 * Em produção isso NÃO é permitido — um deploy sem banco ou com segredos
 * default cairia "saudável" e vulnerável. Ver {@link checkProdEnv}.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TZ: z.string().default('America/Sao_Paulo'),

  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().default(3333),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().default(''),

  JWT_ACCESS_SECRET: z.string().min(16).default(DEV_JWT_ACCESS_SECRET),
  JWT_REFRESH_SECRET: z.string().min(16).default(DEV_JWT_REFRESH_SECRET),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  PASSWORD_HASH_MEMORY_KIB: z.coerce.number().int().default(19456),
  PASSWORD_HASH_TIME_COST: z.coerce.number().int().default(2),

  JOBS_ENABLED: booleanish(false),
  PGBOSS_SCHEMA: z.string().default('pgboss'),
  /**
   * Segredo que protege as rotas internas de cron (`POST /api/v1/internal/cron/:task`).
   * Sem ele, essas rotas ficam desativadas (404). Defina no Render junto do
   * Cron Job / scheduler externo.
   */
  CRON_SECRET: z.string().optional(),

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

/**
 * Trava de produção: falha o boot se o deploy estiver rodando com segredos
 * default, sem banco, ou com backup ligado sem chave de criptografia.
 */
function checkProdEnv(e: z.infer<typeof schema>): string[] {
  if (e.NODE_ENV !== 'production') return [];
  const errs: string[] = [];

  if (e.DATABASE_URL.trim().length === 0) {
    errs.push('DATABASE_URL: obrigatório em produção (a API não sobe em modo degradado).');
  }
  if (e.JWT_ACCESS_SECRET === DEV_JWT_ACCESS_SECRET) {
    errs.push('JWT_ACCESS_SECRET: ainda está com o valor de desenvolvimento — gere um segredo real.');
  }
  if (e.JWT_REFRESH_SECRET === DEV_JWT_REFRESH_SECRET) {
    errs.push('JWT_REFRESH_SECRET: ainda está com o valor de desenvolvimento — gere um segredo real.');
  }
  if (e.JWT_ACCESS_SECRET.length < 32) {
    errs.push('JWT_ACCESS_SECRET: use pelo menos 32 caracteres (node -e "crypto.randomBytes(48).toString(\'base64url\')").');
  }
  if (e.JWT_REFRESH_SECRET.length < 32) {
    errs.push('JWT_REFRESH_SECRET: use pelo menos 32 caracteres.');
  }
  if (e.JWT_ACCESS_SECRET === e.JWT_REFRESH_SECRET) {
    errs.push('JWT_ACCESS_SECRET e JWT_REFRESH_SECRET não podem ser iguais.');
  }
  if (e.BACKUP_ENABLED && !e.SECRETS_ENCRYPTION_KEY) {
    errs.push('SECRETS_ENCRYPTION_KEY: obrigatório quando BACKUP_ENABLED=true.');
  }
  return errs;
}

const prodErrors = checkProdEnv(parsed.data);
if (prodErrors.length > 0) {
  // eslint-disable-next-line no-console
  console.error(`❌ Configuração de produção insegura:\n${prodErrors.map((m) => `  - ${m}`).join('\n')}`);
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
