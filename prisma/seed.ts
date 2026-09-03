/**
 * Seed de desenvolvimento: cria um usuário demo com contas, categorias,
 * um cartão e alguns lançamentos. Rode com:  npm run db:seed
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
} from '@nodepay/shared';

const prisma = new PrismaClient();
const DEMO_EMAIL = 'demo@nodepay.local';
const DEMO_PASSWORD = 'nodepay123';

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    console.log(`Usuário demo já existe (${DEMO_EMAIL}). Nada a fazer.`);
    return;
  }

  const user = await prisma.user.create({
    data: {
      name: 'Administrador Demo',
      email: DEMO_EMAIL,
      passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
      role: 'ADMIN',
      status: 'ACTIVE',
      approvedAt: new Date(),
      settings: { create: {} },
    },
  });

  await prisma.category.createMany({
    data: [
      ...DEFAULT_EXPENSE_CATEGORIES.map((name) => ({ userId: user.id, name, kind: 'EXPENSE' as const })),
      ...DEFAULT_INCOME_CATEGORIES.map((name) => ({ userId: user.id, name, kind: 'INCOME' as const })),
    ],
  });

  const corrente = await prisma.account.create({
    data: { userId: user.id, name: 'Conta Corrente', type: 'CHECKING', openingBalance: 350_000n },
  });
  await prisma.account.create({
    data: { userId: user.id, name: 'Dinheiro', type: 'CASH', openingBalance: 20_000n },
  });

  await prisma.creditCard.create({
    data: {
      userId: user.id,
      name: 'Cartão final 1234',
      lastDigits: '1234',
      brand: 'Visa',
      creditLimit: 800_000n,
      closingDay: 20,
      dueDay: 27,
      defaultPaymentAccountId: corrente.id,
    },
  });

  const alimentacao = await prisma.category.findFirstOrThrow({
    where: { userId: user.id, name: 'Alimentação' },
  });

  await prisma.transaction.create({
    data: {
      userId: user.id,
      type: 'EXPENSE',
      status: 'PAID',
      amount: 12_050n,
      description: 'Compras Supermercado',
      competenceDate: new Date('2026-09-01T00:00:00Z'),
      dueDate: new Date('2026-09-01T00:00:00Z'),
      paidDate: new Date('2026-09-01T00:00:00Z'),
      accountId: corrente.id,
      categoryId: alimentacao.id,
    },
  });

  console.log(`✅ Seed pronto. Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
