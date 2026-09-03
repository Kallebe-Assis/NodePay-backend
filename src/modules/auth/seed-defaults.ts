import type { Prisma, PrismaClient } from '@prisma/client';
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from '@nodepay/shared';

type Db = PrismaClient | Prisma.TransactionClient;

/** Categorias padrão + registro de configurações para um usuário novo. */
export async function seedUserDefaults(db: Db, userId: string): Promise<void> {
  await db.category.createMany({
    data: [
      ...DEFAULT_EXPENSE_CATEGORIES.map((name) => ({ userId, name, kind: 'EXPENSE' as const })),
      ...DEFAULT_INCOME_CATEGORIES.map((name) => ({ userId, name, kind: 'INCOME' as const })),
    ],
    skipDuplicates: true,
  });
  await db.userSettings.upsert({ where: { userId }, create: { userId }, update: {} });
}
