# NodePay — Backend (API)

**Fastify 5 + TypeScript + Prisma + PostgreSQL.** Diretório autossuficiente:
pode ser deployado sozinho (Railway, Render, Fly.io, VPS…).

## Rodar

```bash
cd backend
cp .env.example .env      # e preencha DATABASE_URL + segredos
npm install               # (roda `prisma generate` no postinstall)
npm run db:migrate        # aplica o schema
npm run db:seed           # opcional: cria demo@nodepay.local / nodepay123 (ADMIN)
npm run dev               # porta 3333
```

- API: `http://localhost:3333`
- Swagger: `http://localhost:3333/docs`
- Sem `DATABASE_URL` a API sobe em **modo degradado** (só as rotas de saúde
  respondem; as de dados retornam `503`).

### Produção

```bash
npm ci                    # postinstall roda `prisma generate`
npm run build             # tsup -> dist/main.js  (OBRIGATÓRIO: dist/ NÃO vai no git)
npm run db:deploy         # prisma migrate deploy  (opcional/pré-deploy)
npm start                 # node dist/main.js
```

> `dist/` está no `.gitignore`, então **o build tem que rodar no servidor**.
> Sem `npm run build` você recebe `Cannot find module .../dist/main.js` ao iniciar.
> `prisma`, `tsup`, `tsx` e `typescript` estão em `dependencies` (não `devDependencies`)
> justamente para o build funcionar mesmo com `NODE_ENV=production`.

### Deploy no Render (Web Service)

| Campo | Valor |
|---|---|
| **Root Directory** | *(vazio — o repo `NodePay-backend` já tem tudo na raiz)* |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm start` |
| **Pre-Deploy Command** | `npm run db:deploy` *(opcional, aplica migrações)* |
| **Environment** | Node · versão pelo `.nvmrc` (22) |

Variáveis de ambiente **obrigatórias** (as demais têm default no `config/env.ts`):

| Var | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | connection string do Postgres — ver Supabase abaixo |
| `WEB_ORIGIN` | `https://nodepay-sync.vercel.app` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | 48 bytes base64url cada |
| `SECRETS_ENCRYPTION_KEY` | 32 bytes base64url (não trocar depois) |

**Não** defina `PORT`/`API_PORT` — o Render injeta `PORT` e o app usa ele.
Health check path: `/health`. Railway/Fly seguem a mesma ideia.

### Banco no Supabase

Pegue a string em **Project Settings → Database → Connection string**:

- **Session pooler** (porta `5432`) — use esta no Render (serve p/ runtime **e**
  migrações): `postgresql://postgres.<ref>:SENHA@aws-0-<regiao>.pooler.supabase.com:5432/postgres`
- **Transaction pooler** (porta `6543`, `?pgbouncer=true`) — só para serverless.
- **Direta** (`db.<ref>.supabase.co:5432`) — funciona da sua máquina (pode ser
  IPv6-only), boa para rodar `npm run db:deploy` / `npm run db:seed` localmente.

As migrações já foram aplicadas neste banco (`npm run db:deploy`). O banco
começa **vazio** — o primeiro usuário que se registrar no app vira **ADMIN**
automaticamente (não rode `db:seed` em produção, senão o admin será o `demo`).

## Código compartilhado

`backend/shared/` é uma **cópia vendorizada** de `@nodepay/shared` (schemas Zod,
tipos, `money`/`date`, regra de fatura, amortização). É resolvida por
`file:./shared` no `package.json` e pelo `paths` do `tsconfig.json`; o `tsup`
a embute no bundle. **Ao mudar um schema, replique em `frontend/shared/`.**

## Estrutura (`src/`)

| Pasta | Papel |
|---|---|
| `main.ts` / `app.ts` | bootstrap: monta o Fastify e registra plugins + rotas |
| `config/env.ts` | validação do `.env` (dotenv + Zod), com *fail fast* |
| `plugins/` | `cors`, `helmet`, `jwt`/`auth` (`app.authenticate`, `app.requireAdmin`), `error-handler`, `swagger`, `prisma` |
| `lib/` | utilitários puros: `prisma`, `errors`, `money` (BigInt ↔ number), `crypto` (AES-256-GCM), `password` (argon2), `date` (datas de calendário sem fuso), `scope` (RBAC) |
| `modules/<x>/` | **um módulo por domínio**: `<x>.routes.ts` (HTTP + schema Zod) + `<x>.service.ts` (regra de negócio) |

Módulos: `health`, `auth`, `users`, `accounts`, `categories`, `transactions`,
`credit-cards`, `invoices`, `loans`, `dashboard`, `calendar`, `reports`,
`notifications`, `settings`, `backup`, `telegram`, `jobs`.

## Convenções

- **Dinheiro** sempre em **centavos inteiros** (`BigInt` no banco, `number` no
  JSON). Nunca `float`. Ver `shared/src/money.ts`.
- **Datas de calendário** (competência, vencimento, pagamento) são `@db.Date` e
  trafegam como `"YYYY-MM-DD"`. Ler/escrever só via `lib/date.ts` para não
  deslocar o dia por causa do fuso.
- **`transactions` é o livro-razão.** O sinal (entra/sai) vem do `type`; o valor
  é sempre positivo. Transferência = 1 linha com origem + destino.
- **RBAC**: `ownerFilter(req)` / `targetOwnerId(req)` em `lib/scope.ts` limitam
  cada consulta ao dono certo (admin pode escolher "ver como").
- Toda rota usa `fastify.withTypeProvider<ZodTypeProvider>()` para tipar os
  schemas Zod sob a encapsulação do Fastify.
- Booleans vindos de env/query: usar `booleanish()` do `@nodepay/shared`
  (`z.coerce.boolean()` transforma `"false"` em `true`).

## PDF

`modules/reports/pdf.ts` usa `puppeteer-core` apontando para um Chrome/Edge/
Chromium **já instalado**, descoberto por `modules/reports/chromium.ts`. Só
defina `PUPPETEER_EXECUTABLE_PATH` se o navegador estiver num caminho incomum.
Em serverless, troque por `@sparticuz/chromium`.

## Deploy — pontos de atenção

- **CORS**: `WEB_ORIGIN` = URL pública do front.
- **Prisma + pooler**: em Postgres gerenciado use a connection string com
  `?pgbouncer=true&connection_limit=1`.
- **Jobs (`pg-boss`) e bot do Telegram (long-polling)** precisam de **processo
  contínuo** — não rodam em funções serverless sem adaptação (cron + webhook).
- **Backup** usa o binário `pg_dump` no PATH.

## Testes

```bash
npm test        # vitest — regras puras de domínio
```
