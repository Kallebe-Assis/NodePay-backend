import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { type LoginBody, type RegisterBody } from '@nodepay/shared';
import { env } from '../../config/env.js';
import { Errors } from '../../lib/errors.js';
import { burnPasswordTime, hashPassword, verifyPassword } from '../../lib/password.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { invalidateUserAuth } from '../../lib/user-auth-cache.js';
import { writeAudit } from '../../lib/audit.js';
import { seedUserDefaults } from './seed-defaults.js';

function ttlToMs(ttl: string): number {
  const m = ttl.match(/^(\d+)([smhd])$/);
  if (!m) return 30 * 24 * 3600_000;
  const n = Number(m[1]);
  return n * { s: 1000, m: 60_000, h: 3600_000, d: 86_400_000 }[m[2] as 's' | 'm' | 'h' | 'd'];
}

export class AuthService {
  constructor(
    private readonly app: FastifyInstance,
    private readonly db: PrismaClient,
  ) {}

  private async issueTokens(
    userId: string,
    role: 'ADMIN' | 'USER',
    meta: { ip?: string; userAgent?: string },
  ) {
    const accessToken = this.app.jwt.sign({ sub: userId, type: 'access', role });
    const refreshToken = randomToken(48);
    const session = await this.db.session.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        ip: meta.ip,
        userAgent: meta.userAgent,
        expiresAt: new Date(Date.now() + ttlToMs(env.JWT_REFRESH_TTL)),
      },
    });
    return {
      sessionId: session.id,
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: Math.floor(ttlToMs(env.JWT_ACCESS_TTL) / 1000),
      },
    };
  }

  /** Encerra todas as sessões vivas de um usuário (ex.: reuso de refresh token). */
  private async revokeAllSessions(userId: string) {
    await this.db.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private seedUserDefaults(userId: string) {
    return seedUserDefaults(this.db, userId);
  }

  async register(body: RegisterBody, meta: { ip?: string; userAgent?: string }) {
    const existing = await this.db.user.findUnique({ where: { email: body.email } });
    if (existing) throw Errors.conflict('E-mail já cadastrado');

    // O PRIMEIRO usuário do sistema vira ADMIN e já entra ativo (bootstrap).
    const isFirstUser = (await this.db.user.count()) === 0;

    const user = await this.db.user.create({
      data: {
        name: body.name,
        email: body.email,
        passwordHash: await hashPassword(body.password),
        role: isFirstUser ? 'ADMIN' : 'USER',
        status: isFirstUser ? 'ACTIVE' : 'PENDING',
        approvedAt: isFirstUser ? new Date() : null,
      },
    });
    await this.seedUserDefaults(user.id);

    if (user.status !== 'ACTIVE') {
      return {
        pending: true as const,
        result: {
          status: 'PENDING' as const,
          message:
            'Cadastro recebido. Um administrador precisa aprovar seu acesso antes do primeiro login.',
        },
      };
    }

    const { tokens } = await this.issueTokens(user.id, user.role, meta);
    return { pending: false as const, result: { user: this.publicUser(user), tokens } };
  }

  async login(body: LoginBody, meta: { ip?: string; userAgent?: string }) {
    const user = await this.db.user.findUnique({ where: { email: body.email } });
    if (!user) {
      // sem conta: gasta o mesmo tempo de um verify real p/ não vazar existência
      await burnPasswordTime(body.password);
      throw Errors.unauthorized('E-mail ou senha inválidos');
    }
    if (!(await verifyPassword(user.passwordHash, body.password))) {
      throw Errors.unauthorized('E-mail ou senha inválidos');
    }
    if (user.status === 'PENDING') {
      throw Errors.forbidden('Conta aguardando aprovação de um administrador');
    }
    if (user.status === 'SUSPENDED') {
      throw Errors.forbidden('Conta suspensa. Fale com um administrador.');
    }
    const { tokens } = await this.issueTokens(user.id, user.role, meta);
    return { user: this.publicUser(user), tokens };
  }

  async refresh(refreshToken: string, meta: { ip?: string; userAgent?: string }) {
    const hash = sha256(refreshToken);
    const session = await this.db.session.findUnique({ where: { tokenHash: hash } });
    if (!session || session.expiresAt < new Date()) {
      throw Errors.unauthorized('Sessão inválida ou expirada');
    }

    if (session.revokedAt) {
      // Reapresentação de um token já rotacionado. Duas abas/telas do MESMO
      // usuário podem legitimamente disparar renovações quase juntas (cada
      // uma lê o refresh token da localStorage antes da outra escrever o
      // novo) — isso não é roubo, é corrida entre clientes do dono da conta.
      // Dentro de uma janela curta após a rotação, tratamos como corrida
      // benigna e emitimos mais uma rotação normalmente. Só fora dessa
      // janela — token antigo reaparecendo minutos/horas depois — é sinal
      // de replay de token vazado, e aí derrubamos todas as sessões.
      const REUSE_GRACE_MS = 15_000;
      const withinGrace =
        session.replacedById != null &&
        session.revokedAt.getTime() > Date.now() - REUSE_GRACE_MS;

      if (!withinGrace) {
        if (session.replacedById) {
          await this.revokeAllSessions(session.userId);
          await writeAudit(this.db, {
            actorId: session.userId,
            entity: 'session',
            entityId: session.id,
            action: 'refresh-reuse-detected',
            diff: { ip: meta.ip ?? null },
          });
        }
        throw Errors.unauthorized('Sessão inválida ou expirada');
      }
      // dentro da janela de corrida: segue para emitir mais uma rotação,
      // sem derrubar as outras sessões do usuário.
    }

    const user = await this.db.user.findUniqueOrThrow({ where: { id: session.userId } });
    if (user.status !== 'ACTIVE') throw Errors.forbidden('Conta inativa');

    // rotação: emite a nova. Só marca a sessão atual como substituída se
    // ainda não tiver sido (evita sobrescrever o replacedById original
    // quando essa é a segunda rotação da mesma corrida benigna acima).
    const { sessionId, tokens } = await this.issueTokens(user.id, user.role, meta);
    if (!session.revokedAt) {
      await this.db.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date(), replacedById: sessionId },
      });
    }
    return { user: this.publicUser(user), tokens };
  }

  async logout(refreshToken: string) {
    await this.db.session
      .updateMany({ where: { tokenHash: sha256(refreshToken) }, data: { revokedAt: new Date() } })
      .catch(() => undefined);
  }

  async me(userId: string) {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw Errors.notFound('Usuário');
    return this.publicUser(user);
  }

  async updateProfile(userId: string, name: string) {
    const user = await this.db.user.update({ where: { id: userId }, data: { name } });
    return this.publicUser(user);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(user.passwordHash, currentPassword))) {
      throw Errors.unauthorized('Senha atual incorreta');
    }
    await this.db.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(newPassword) },
    });
    // encerra as outras sessões por segurança
    await this.db.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * "Excluir minha conta" — na prática desativa o login (status SUSPENDED) e
   * encerra as sessões. Não expõe ao usuário que é reversível.
   *
   * O e-mail original é liberado (renomeado para `deleted+<ts>_<email>`) para
   * que a pessoa possa se recadastrar depois. Um admin pode restaurar a conta
   * revertendo o e-mail e o status pela tela de usuários.
   */
  async deleteOwnAccount(userId: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.role === 'ADMIN' && user.status === 'ACTIVE') {
      const otherAdmins = await this.db.user.count({
        where: { role: 'ADMIN', status: 'ACTIVE', id: { not: userId } },
      });
      if (otherAdmins === 0) {
        throw Errors.badRequest('Não é possível excluir a única conta de administrador ativa.');
      }
    }
    const freedEmail = `deleted+${Date.now()}_${user.email}`.slice(0, 250);
    await this.db.user.update({
      where: { id: userId },
      data: { status: 'SUSPENDED', email: freedEmail },
    });
    await this.db.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    invalidateUserAuth(userId);
    await writeAudit(this.db, {
      actorId: userId,
      entity: 'user',
      entityId: userId,
      action: 'self-delete',
      diff: { email: { from: user.email, to: freedEmail } },
    });
  }

  async listSessions(userId: string) {
    const rows = await this.db.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
    }));
  }

  private publicUser(u: {
    id: string;
    name: string;
    email: string;
    role: 'ADMIN' | 'USER';
    status: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
    createdAt: Date;
  }) {
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      createdAt: u.createdAt.toISOString(),
    };
  }
}
