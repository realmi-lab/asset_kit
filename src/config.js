import { readFileSync } from 'node:fs';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { KitError } from './errors.js';

/** Local folder for history, dashboard boards, and keys saved by `asset-kit config init`. */
export const dataDir = (env = process.env) => env.ASSET_KIT_DATA_DIR || join(homedir(), '.bithumb-asset-kit');
export const credentialsFile = (env = process.env) => join(dataDir(env), 'credentials.json');

const validKey = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && value.trim() === value && !/[\r\n\0]/.test(value);

/** Key lookup order: explicit options → environment variables → the `config init` file. */
export function resolveCredentials({ accessKey, secretKey, env = process.env } = {}) {
  if (accessKey !== undefined || secretKey !== undefined) {
    return { accessKey: accessKey?.trim() ?? '', secretKey: secretKey?.trim() ?? '', source: 'options' };
  }
  if (env.BITHUMB_ACCESS_KEY || env.BITHUMB_SECRET_KEY) {
    return { accessKey: env.BITHUMB_ACCESS_KEY?.trim() ?? '', secretKey: env.BITHUMB_SECRET_KEY?.trim() ?? '', source: 'environment' };
  }
  let stored;
  try { stored = JSON.parse(readFileSync(credentialsFile(env), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return { accessKey: '', secretKey: '', source: null };
    throw new KitError('CONFIG_INVALID', '로컬 키 설정 파일을 읽지 못했습니다. asset-kit config init으로 다시 설정하세요.', 500);
  }
  if (!validKey(stored?.accessKey) || !validKey(stored?.secretKey)) {
    throw new KitError('CONFIG_INVALID', '로컬 키 설정 파일의 형식이 올바르지 않습니다. asset-kit config init으로 다시 설정하세요.', 500);
  }
  return { accessKey: stored.accessKey, secretKey: stored.secretKey, source: 'file' };
}

/** Atomically writes both keys with owner-only permissions. Never logs or returns the values. */
export async function saveCredentials(accessKey, secretKey, env = process.env) {
  if (!validKey(accessKey) || !validKey(secretKey)) throw new KitError('CONFIG_INVALID', 'Access Key와 Secret Key를 앞뒤 공백 없이 입력하세요.', 400);
  const file = credentialsFile(env), temp = `${file}.${randomUUID()}`;
  await mkdir(dataDir(env), { recursive: true, mode: 0o700 });
  await writeFile(temp, JSON.stringify({ accessKey, secretKey }), { mode: 0o600 });
  await rename(temp, file);
  await chmod(file, 0o600);
  return file;
}
