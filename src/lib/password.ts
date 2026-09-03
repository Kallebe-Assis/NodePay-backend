import argon2 from 'argon2';
import { env } from '../config/env.js';

const options: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: env.PASSWORD_HASH_MEMORY_KIB,
  timeCost: env.PASSWORD_HASH_TIME_COST,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, options);
}

export function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain).catch(() => false);
}
