import type { PrismaClient } from '@prisma/client';
import type { AdminCreateUserBody, AdminUpdateUserBody, ListUsersQuery } from '@nodepay/shared';
import { Errors } from '../../lib/errors.js';
import { hashPassword } from '../../lib/password.js';
import { seedUserDefaults } from '../auth/seed-defaults.js';

/** CRUD de usuários — todas as rotas exigem role ADMIN. */
export class UsersService {
  constructor(private readonly db: PrismaClient) {}

  async list(q: ListUsersQuery) {
    const where = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.role ? { role: q.role } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' as const } },
              { email: { contains: q.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.db.user.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          _count: { select: { accounts: true, transactions: true, creditCards: true } },
        },
      }),
      this.db.user.count({ where }),
    ]);

    return {
      data: rows.map((u) => this.present(u)),
      page: q.page,
      pageSize: q.pageSize,
      total,
    };
  }

  async get(id: string) {
    const u = await this.db.user.findUnique({
      where: { id },
      include: { _count: { select: { accounts: true, transactions: true, creditCards: true } } },
    });
    if (!u) throw Errors.notFound('Usuário');
    return this.present(u);
  }

  async create(body: AdminCreateUserBody) {
    const exists = await this.db.user.findUnique({ where: { email: body.email } });
    if (exists) throw Errors.conflict('E-mail já cadastrado');

    const user = await this.db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: body.name,
          email: body.email,
          passwordHash: await hashPassword(body.password),
          role: body.role,
          status: body.status,
          approvedAt: body.status === 'ACTIVE' ? new Date() : null,
        },
      });
      await seedUserDefaults(tx, created.id);
      return created;
    });
    return this.present({ ...user, _count: { accounts: 0, transactions: 0, creditCards: 0 } });
  }

  async update(id: string, body: AdminUpdateUserBody, actingAdminId: string) {
    const target = await this.db.user.findUnique({ where: { id } });
    if (!target) throw Errors.notFound('Usuário');

    // não deixar o sistema ficar sem nenhum admin ativo
    if (
      (body.role === 'USER' || body.status === 'SUSPENDED') &&
      target.role === 'ADMIN' &&
      target.status === 'ACTIVE'
    ) {
      await this.assertNotLastActiveAdmin(id);
    }
    if (id === actingAdminId && body.role === 'USER') {
      throw Errors.badRequest('Você não pode remover seu próprio acesso de administrador');
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.role !== undefined) data.role = body.role;
    if (body.status !== undefined) {
      data.status = body.status;
      if (body.status === 'ACTIVE' && !target.approvedAt) data.approvedAt = new Date();
    }
    if (body.password) data.passwordHash = await hashPassword(body.password);

    const updated = await this.db.user.update({
      where: { id },
      data,
      include: { _count: { select: { accounts: true, transactions: true, creditCards: true } } },
    });

    if (body.status === 'SUSPENDED' || body.password) {
      await this.db.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return this.present(updated);
  }

  async approve(id: string, actingAdminId: string) {
    const u = await this.db.user.findUnique({ where: { id } });
    if (!u) throw Errors.notFound('Usuário');
    if (u.status === 'ACTIVE') return this.get(id);
    await this.db.user.update({
      where: { id },
      data: { status: 'ACTIVE', approvedAt: new Date(), approvedById: actingAdminId },
    });
    return this.get(id);
  }

  async suspend(id: string, actingAdminId: string) {
    if (id === actingAdminId) throw Errors.badRequest('Você não pode suspender a si mesmo');
    const u = await this.db.user.findUnique({ where: { id } });
    if (!u) throw Errors.notFound('Usuário');
    if (u.role === 'ADMIN' && u.status === 'ACTIVE') await this.assertNotLastActiveAdmin(id);

    await this.db.user.update({ where: { id }, data: { status: 'SUSPENDED' } });
    await this.db.session.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return this.get(id);
  }

  async remove(id: string, actingAdminId: string) {
    if (id === actingAdminId) throw Errors.badRequest('Você não pode excluir a si mesmo');
    const u = await this.db.user.findUnique({ where: { id } });
    if (!u) throw Errors.notFound('Usuário');
    if (u.role === 'ADMIN' && u.status === 'ACTIVE') await this.assertNotLastActiveAdmin(id);

    await this.db.user.delete({ where: { id } }); // cascade em todos os dados do usuário
    return { deleted: true };
  }

  private async assertNotLastActiveAdmin(excludingId: string) {
    const others = await this.db.user.count({
      where: { role: 'ADMIN', status: 'ACTIVE', id: { not: excludingId } },
    });
    if (others === 0) throw Errors.badRequest('Precisa haver ao menos um administrador ativo');
  }

  private present(u: any) {
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      createdAt: u.createdAt.toISOString(),
      approvedAt: u.approvedAt ? u.approvedAt.toISOString() : null,
      counts: u._count
        ? {
            accounts: u._count.accounts,
            transactions: u._count.transactions,
            creditCards: u._count.creditCards,
          }
        : undefined,
    };
  }
}
