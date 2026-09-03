import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Criptografia simétrica (AES-256-GCM) para segredos guardados no banco:
 * chaves da Backblaze e afins, preenchidos pelo usuário na tela de Configurações.
 * A chave mestra vem de SECRETS_ENCRYPTION_KEY.
 */
function masterKey(): Buffer {
  const raw = env.SECRETS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('SECRETS_ENCRYPTION_KEY não configurada — necessária para salvar segredos.');
  }
  // aceita base64url de 32 bytes, ou deriva via sha-256 de qualquer string
  const buf = Buffer.from(raw, 'base64url');
  return buf.length === 32 ? buf : createHash('sha256').update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Segredo criptografado malformado');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    masterKey(),
    Buffer.from(ivB64, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
