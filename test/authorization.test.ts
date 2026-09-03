/**
 * Testes de integração: isolamento entre usuários, cascade de exclusão e
 * detecção de reuso de refresh token.
 *
 * NÃO rodam num `npm test` comum — precisam de um Postgres descartável e do
 * flag explícito `RUN_DB_TESTS=1` (para nunca tocarem no banco de produção que
 * o `.env` local aponta). O CI liga o flag com um container dedicado.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { LightMyRequestResponse } from 'fastify';
import type { AppInstance } from '../src/types/app.js';

type Res = Promise<LightMyRequestResponse>;
type Body = Record<string, unknown>;

const RUN = process.env.RUN_DB_TESTS === '1' && !!process.env.DATABASE_URL;
const RID = `it${Date.now().toString(36)}`;
const pass = 'Sup3rSecret!42';

describe.skipIf(!RUN)('isolamento e permissões', () => {
  let app: AppInstance;
  let db: PrismaClient;
  let adminTok = '';
  let aTok = '';
  let bAccountId = '';
  let bUserId = '';

  const api = (token: string) => {
    const h = { authorization: `Bearer ${token}` };
    return {
      get: (url: string): Res => app.inject({ method: 'GET', url, headers: h }),
      post: (url: string, payload?: Body): Res =>
        app.inject({ method: 'POST', url, headers: h, payload }),
      patch: (url: string, payload?: Body): Res =>
        app.inject({ method: 'PATCH', url, headers: h, payload }),
      delete: (url: string): Res => app.inject({ method: 'DELETE', url, headers: h }),
    };
  };

  const register = (name: string): Res =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { name, email: `${RID}.${name}@test.local`, password: pass },
    });

  beforeAll(async () => {
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    await app.ready();
    db = new PrismaClient();

    // 1º usuário → ADMIN ativo com tokens
    const admin = await register('admin');
    const adminBody = admin.json();
    if (!adminBody?.tokens?.accessToken) {
      throw new Error('registro do 1º usuário não retornou tokens — o banco de teste não está limpo');
    }
    adminTok = adminBody.tokens.accessToken;

    // usuário A → PENDING, precisa de aprovação
    await register('userA');
    const usersList = await api(adminTok).get(`/api/v1/users?search=${RID}.userA`);
    const aId = usersList.json().data[0].id;
    await api(adminTok).post(`/api/v1/users/${aId}/approve`);
    const aLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: `${RID}.userA@test.local`, password: pass },
    });
    aTok = aLogin.json().tokens.accessToken;

    // usuário B → aprovado, com 1 conta + 1 transação
    await register('userB');
    const bList = await api(adminTok).get(`/api/v1/users?search=${RID}.userB`);
    bUserId = bList.json().data[0].id;
    await api(adminTok).post(`/api/v1/users/${bUserId}/approve`);
    const bLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: `${RID}.userB@test.local`, password: pass },
    });
    const bTok = bLogin.json().tokens.accessToken;
    const bAcc = await api(bTok).post('/api/v1/accounts', {
      name: 'Conta B',
      type: 'CHECKING',
      openingBalance: 100000,
    });
    bAccountId = bAcc.json().id;
    await db.transaction.create({
      data: {
        userId: bUserId,
        type: 'EXPENSE',
        amount: 5000n,
        description: 'gasto B',
        competenceDate: new Date('2026-09-01T00:00:00Z'),
        dueDate: new Date('2026-09-01T00:00:00Z'),
        accountId: bAccountId,
      },
    });
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { email: { startsWith: RID } } });
    await db.$disconnect();
    await app.close();
  });

  it('USER A não vê a conta de B na listagem', async () => {
    const res = await api(aTok).get('/api/v1/accounts');
    expect(res.statusCode).toBe(200);
    expect(res.json().map((a: { id: string }) => a.id)).not.toContain(bAccountId);
  });

  it('USER A não consegue LER a conta de B por id (404)', async () => {
    const res = await api(aTok).get(`/api/v1/accounts/${bAccountId}`);
    expect(res.statusCode).toBe(404);
  });

  it('USER A não consegue ALTERAR a conta de B', async () => {
    const res = await api(aTok).patch(`/api/v1/accounts/${bAccountId}`, { name: 'invadida' });
    expect([403, 404]).toContain(res.statusCode);
    const still = await db.account.findUnique({ where: { id: bAccountId } });
    expect(still?.name).toBe('Conta B');
  });

  it('USER A não consegue EXCLUIR a conta de B', async () => {
    const res = await api(aTok).delete(`/api/v1/accounts/${bAccountId}`);
    expect([403, 404]).toContain(res.statusCode);
    expect(await db.account.findUnique({ where: { id: bAccountId } })).not.toBeNull();
  });

  it('USER A não enxerga transações de B', async () => {
    const res = await api(aTok).get('/api/v1/transactions');
    expect(res.statusCode).toBe(200);
    expect(res.json().data.every((t: { description: string }) => t.description !== 'gasto B')).toBe(true);
  });

  it('ADMIN consegue ler a conta de B via ?userId', async () => {
    const res = await api(adminTok).get(`/api/v1/accounts?userId=${bUserId}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().map((a: { id: string }) => a.id)).toContain(bAccountId);
  });

  it('excluir o usuário B apaga em cascata contas e transações dele', async () => {
    const del = await api(adminTok).delete(`/api/v1/users/${bUserId}`);
    expect(del.statusCode).toBe(200);
    expect(await db.account.count({ where: { userId: bUserId } })).toBe(0);
    expect(await db.transaction.count({ where: { userId: bUserId } })).toBe(0);
    expect(await db.user.findUnique({ where: { id: bUserId } })).toBeNull();
    // a ação ficou registrada na auditoria
    const audit = await db.auditLog.findFirst({
      where: { entity: 'user', entityId: bUserId, action: 'delete' },
    });
    expect(audit).not.toBeNull();
  });

  it('reapresentar um refresh token já rotacionado derruba todas as sessões', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: `${RID}.userA@test.local`, password: pass },
    });
    const rt1 = login.json().tokens.refreshToken;

    const r1 = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: rt1 } });
    expect(r1.statusCode).toBe(200);
    const rt2 = r1.json().tokens.refreshToken;

    // reuso do rt1 (já rotacionado) → 401 e revoga a família inteira
    const reuse = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: rt1 } });
    expect(reuse.statusCode).toBe(401);

    const afterReuse = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: rt2 } });
    expect(afterReuse.statusCode).toBe(401);
  });
});
