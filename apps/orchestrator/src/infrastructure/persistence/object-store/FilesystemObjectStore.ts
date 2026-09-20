import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  IObjectStore,
  ObjectMetadata,
  PutObjectOptions
} from '../../../application/ports/persistence/IObjectStore.js';

export interface FilesystemObjectStoreOptions {
  readonly baseDir: string;
}

function resolveKeyPath(baseDir: string, key: string): string {
  if (!key || typeof key !== 'string' || key.trim().length === 0) {
    throw new Error('Object key cannot be empty');
  }
  if (key.includes('\0')) {
    throw new Error(`Invalid key '${key}': null byte detected`);
  }
  const resolved = path.resolve(baseDir, key);
  const rel = path.relative(baseDir, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '') {
    throw new Error(`Path traversal detected: key '${key}' escapes base directory`);
  }
  return resolved;
}

export class FilesystemObjectStore implements IObjectStore {
  readonly baseDir: string;

  constructor(options: FilesystemObjectStoreOptions) {
    this.baseDir = options.baseDir;
  }

  async putObject(
    key: string,
    data: Buffer | Uint8Array | string,
    options?: PutObjectOptions
  ): Promise<ObjectMetadata> {
    const filePath = resolveKeyPath(this.baseDir, key);
    const buffer = Buffer.isBuffer(data)
      ? data
      : typeof data === 'string'
        ? Buffer.from(data, 'utf8')
        : Buffer.from(data);

    const hash = options?.contentHash ?? crypto.createHash('sha256').update(buffer).digest('hex');

    if (options?.overwrite === false) {
      try {
        await fs.access(filePath);
        throw new Error(`Object with key '${key}' already exists`);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // Write via atomic temp file
    const tempPath = `${filePath}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(tempPath, buffer);
    await fs.rename(tempPath, filePath);

    const stat = await fs.stat(filePath);
    return {
      key,
      sizeBytes: stat.size,
      contentHash: hash,
      lastModified: stat.mtime,
      contentType: options?.contentType ?? 'application/octet-stream'
    };
  }

  async getObject(key: string): Promise<Buffer | undefined> {
    try {
      const filePath = resolveKeyPath(this.baseDir, key);
      return await fs.readFile(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw err;
    }
  }

  async getObjectString(key: string): Promise<string | undefined> {
    try {
      const filePath = resolveKeyPath(this.baseDir, key);
      return await fs.readFile(filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw err;
    }
  }

  async hasObject(key: string): Promise<boolean> {
    try {
      const filePath = resolveKeyPath(this.baseDir, key);
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async deleteObject(key: string): Promise<boolean> {
    try {
      const filePath = resolveKeyPath(this.baseDir, key);
      await fs.unlink(filePath);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw err;
    }
  }

  async listObjects(prefix?: string): Promise<readonly ObjectMetadata[]> {
    const results: ObjectMetadata[] = [];

    const walk = async (dir: string): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return;
        }
        throw err;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && !entry.name.endsWith('.tmp')) {
          const relKey = path.relative(this.baseDir, fullPath).split(path.sep).join('/');
          if (!prefix || relKey.startsWith(prefix)) {
            const stat = await fs.stat(fullPath);
            const content = await fs.readFile(fullPath);
            const contentHash = crypto.createHash('sha256').update(content).digest('hex');
            results.push({
              key: relKey,
              sizeBytes: stat.size,
              contentHash,
              lastModified: stat.mtime,
              contentType: 'application/octet-stream'
            });
          }
        }
      }
    };

    await walk(this.baseDir);
    results.sort((a, b) => a.key.localeCompare(b.key));
    return Object.freeze(results);
  }

  async checkHealth(): Promise<{
    status: 'healthy' | 'unhealthy';
    latencyMs: number;
    message?: string;
  }> {
    const start = Date.now();
    try {
      await fs.mkdir(this.baseDir, { recursive: true });
      const testFile = path.join(this.baseDir, `.health-${Date.now()}.tmp`);
      await fs.writeFile(testFile, 'ok', 'utf8');
      await fs.unlink(testFile);
      return {
        status: 'healthy',
        latencyMs: Date.now() - start
      };
    } catch (err) {
      return {
        status: 'unhealthy',
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : String(err)
      };
    }
  }
}
