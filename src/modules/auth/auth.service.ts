import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { type LoginBody, type RegisterBody } from '@nodepay/shared';
import { env } from '../../config/env.js';
import { Errors } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
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
    await this.db.session.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        ip: meta.ip,
        userAgent: meta.userAgent,
        expiresAt: new Date(Date.now() + ttlToMs(env.JWT_REFRESH_TTL)),
      },
    });
    return { accessToken, refreshToken, expiresIn: Math.floor(ttlToMs(env.JWT_ACCESS_TTL) / 1000) };
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

    const tokens = await this.issueTokens(user.id, user.role, meta);
    return { pending: false as const, result: { user: this.publicUser(user), tokens } };
  }

  async login(body: LoginBody, meta: { ip?: string; userAgent?: string }) {
    const user = await this.db.user.findUnique({ where: { email: body.email } });
    if (!user || !(await verifyPassword(user.passwordHash, body.password))) {
      throw Errors.unauthorized('E-mail ou senha inválidos');
    }
    if (user.status === 'PENDING') {
      throw Errors.forbidden('Conta aguardando aprovação de um administrador');
    }
    if (user.status === 'SUSPENDED') {
      throw Errors.forbidden('Conta suspensa. Fale com um administrador.');
    }
    const tokens = await this.issueTokens(user.id, user.role, meta);
    return { user: this.publicUser(user), tokens };
  }

  async refresh(refreshToken: string, meta: { ip?: string; userAgent?: string }) {
    const hash = sha256(refreshToken);
    const session = await this.db.session.findUnique({ where: { tokenHash: hash } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw Errors.unauthorized('Sessão inválida ou expirada');
    }
    // rotação: revoga a atual e emite outra
    await this.db.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    const user = await this.db.user.findUniqueOrThrow({ where: { id: session.userId } });
    if (user.status !== 'ACTIVE') throw Errors.forbidden('Conta inativa');
    const tokens = await this.issueTokens(user.id, user.role, meta);
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
