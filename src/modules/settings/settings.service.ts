import type { PrismaClient } from '@prisma/client';
import type { UpdateSettingsBody } from '@nodepay/shared';
import { encryptSecret, randomToken } from '../../lib/crypto.js';
import { nb, numToBig } from '../../lib/money.js';

export class SettingsService {
  constructor(private readonly db: PrismaClient) {}

  private async ensure(userId: string) {
    return this.db.userSettings.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  async get(userId: string) {
    const s = await this.ensure(userId);
    return this.present(s);
  }

  async update(userId: string, body: UpdateSettingsBody) {
    await this.ensure(userId);
    const data: Record<string, unknown> = {};

    if (body.backup) {
      const b = body.backup;
      if (b.enabled !== undefined) data.backupEnabled = b.enabled;
      if (b.frequency !== undefined) data.backupFrequency = b.frequency;
      if (b.retentionDays !== undefined) data.backupRetentionDays = b.retentionDays;
      if (b.s3Endpoint !== undefined) data.backupS3Endpoint = b.s3Endpoint || null;
      if (b.region !== undefined) data.backupRegion = b.region || null;
      if (b.bucket !== undefined) data.backupBucket = b.bucket || null;
      if (b.keyId) data.backupKeyIdEnc = encryptSecret(b.keyId);
      if (b.appKey) data.backupAppKeyEnc = encryptSecret(b.appKey);
    }

    if (body.telegram) {
      const t = body.telegram;
      if (t.enabled !== undefined) data.telegramEnabled = t.enabled;
      if (t.dailyDigest !== undefined) data.telegramDailyDigest = t.dailyDigest;
      if (t.digestHour !== undefined) data.telegramDigestHour = t.digestHour;
    }

    if (body.notifications) {
      const n = body.notifications;
      if (n.billsDue !== undefined) data.notifyBillsDue = n.billsDue;
      if (n.invoiceClosing !== undefined) data.notifyInvoiceClosing = n.invoiceClosing;
      if (n.lowBalance !== undefined) data.notifyLowBalance = n.lowBalance;
      if (n.weeklySummary !== undefined) data.notifyWeeklySummary = n.weeklySummary;
      if (n.pendingUsers !== undefined) data.notifyPendingUsers = n.pendingUsers;
      if (n.lowBalanceThreshold !== undefined)
        data.lowBalanceThreshold = numToBig(n.lowBalanceThreshold);
    }

    if (body.appearance?.themePref !== undefined) {
      data.themePref = body.appearance.themePref;
    }

    const s = await this.db.userSettings.update({ where: { userId }, data });
    return this.present(s);
  }

  /** Gera token de uso único para o usuário parear o chat no bot: /vincular <token> */
  async createTelegramLinkToken(userId: string) {
    const token = randomToken(12);
    await this.db.userSettings.update({
      where: { userId },
      data: { telegramLinkToken: token },
    });
    return { linkToken: token };
  }

  private present(s: any) {
    return {
      backup: {
        enabled: s.backupEnabled,
        frequency: s.backupFrequency,
        retentionDays: s.backupRetentionDays,
        s3Endpoint: s.backupS3Endpoint,
        region: s.backupRegion,
        bucket: s.backupBucket,
        keyIdConfigured: Boolean(s.backupKeyIdEnc),
        appKeyConfigured: Boolean(s.backupAppKeyEnc),
        lastRunAt: s.backupLastRunAt ? s.backupLastRunAt.toISOString() : null,
        lastRunStatus: s.backupLastStatus,
      },
      telegram: {
        enabled: s.telegramEnabled,
        linked: Boolean(s.telegramChatId),
        dailyDigest: s.telegramDailyDigest,
        digestHour: s.telegramDigestHour,
        linkToken: s.telegramLinkToken,
      },
      notifications: {
        billsDue: s.notifyBillsDue,
        invoiceClosing: s.notifyInvoiceClosing,
        lowBalance: s.notifyLowBalance,
        weeklySummary: s.notifyWeeklySummary,
        pendingUsers: s.notifyPendingUsers,
        lowBalanceThreshold: nb(s.lowBalanceThreshold),
      },
      appearance: {
        themePref: (s.themePref ?? 'system') as 'system' | 'light' | 'dark',
      },
    };
  }
}
