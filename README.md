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
npm ci
npm run db:deploy         # prisma migrate deploy
npm run build             # bundle único em dist/main.js (tsup)
npm start                 # node dist/main.js
```

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
