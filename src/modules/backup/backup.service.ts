import { spawn } from 'node:child_process';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { PassThrough } from 'node:stream';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { env } from '../../config/env.js';
import { Errors } from '../../lib/errors.js';
import { decryptSecret } from '../../lib/crypto.js';

/**
 * Backup: pg_dump -> gzip -> upload S3-compatível (Backblaze B2).
 * As credenciais vêm da tela de Configurações (criptografadas no banco);
 * se ausentes, cai no fallback das variáveis de ambiente B2_*.
 *
 * Requisitos na VPS: binário `pg_dump` no PATH.
 */
interface B2Config {
  endpoint: string;
  region: string;
  bucket: string;
  keyId: string;
  appKey: string;
}

async function resolveConfig(db: PrismaClient, userId: string): Promise<B2Config> {
  const s = await db.userSettings.findUnique({ where: { userId } });
  const endpoint = s?.backupS3Endpoint || env.B2_S3_ENDPOINT || '';
  const region = s?.backupRegion || env.B2_REGION || 'us-east-005';
  const bucket = s?.backupBucket || env.B2_BUCKET || '';
  const keyId = s?.backupKeyIdEnc ? decryptSecret(s.backupKeyIdEnc) : env.B2_KEY_ID || '';
  const appKey = s?.backupAppKeyEnc ? decryptSecret(s.backupAppKeyEnc) : env.B2_APP_KEY || '';
  if (!endpoint || !bucket || !keyId || !appKey) {
    throw Errors.badRequest('Configuração de backup incompleta (endpoint, bucket, chave, segredo).');
  }
  return { endpoint, region, bucket, keyId, appKey };
}

export async function runBackup(db: PrismaClient, userId: string) {
  if (!env.DATABASE_URL) throw Errors.dbUnavailable();
  const cfg = await resolveConfig(db, userId);

  const run = await db.backupRun.create({ data: { userId, status: 'running' } });
  const key = `nodepay/${userId}/${new Date().toISOString().replace(/[:.]/g, '-')}.sql.gz`;

  try {
    const dump = spawn('pg_dump', ['--no-owner', '--no-privileges', env.DATABASE_URL], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    dump.stderr.on('data', (c) => (stderr += c.toString()));

    const gz = createGzip();
    const hash = createHash('sha256');
    const collector = new PassThrough();
    const chunks: Buffer[] = [];
    collector.on('data', (c: Buffer) => {
      chunks.push(c);
      hash.update(c);
    });

    await pipeline(dump.stdout, gz, collector);
    const exitCode: number = await new Promise((res) => dump.on('close', res));
    if (exitCode !== 0) throw new Error(`pg_dump falhou (${exitCode}): ${stderr}`);

    const body = Buffer.concat(chunks);
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      credentials: { accessKeyId: cfg.keyId, secretAccessKey: cfg.appKey },
      forcePathStyle: true,
    });
    await s3.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/gzip',
      }),
    );

    await db.backupRun.update({
      where: { id: run.id },
      data: {
        status: 'success',
        finishedAt: new Date(),
        objectKey: key,
        sizeBytes: BigInt(body.length),
        checksum: hash.digest('hex'),
      },
    });
    await db.userSettings.update({
      where: { userId },
      data: { backupLastRunAt: new Date(), backupLastStatus: 'success' },
    });
    return { ok: true, objectKey: key, sizeBytes: body.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.backupRun.update({
      where: { id: run.id },
      data: { status: 'error', finishedAt: new Date(), error: message.slice(0, 1000) },
    });
    await db.userSettings
      .update({ where: { userId }, data: { backupLastStatus: 'error' } })
      .catch(() => undefined);
    throw Errors.badRequest(`Backup falhou: ${message}`);
  }
}
