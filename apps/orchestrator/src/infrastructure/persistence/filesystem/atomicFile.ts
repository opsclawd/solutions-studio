import fs from 'node:fs/promises';
import path from 'node:path';
import { ImmutableRecordConflictError } from '../../../application/ports/persistence/IRequirementsRepository.js';

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function writeJsonExclusive(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new ImmutableRecordConflictError(filePath);
    }
    throw err;
  }
}

export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await fs.rename(tmpPath, filePath);
}

export async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw err;
  }
}

export async function appendJsonLine(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, JSON.stringify(data) + '\n', 'utf8');
}

export async function readJsonLines<T>(filePath: string): Promise<readonly T[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    return Object.freeze(lines.map((l) => JSON.parse(l) as T));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return Object.freeze([]);
    }
    throw err;
  }
}
