import crypto from 'node:crypto';
import type {
  IObjectStore,
  ObjectMetadata,
  PutObjectOptions
} from '../../../application/ports/persistence/IObjectStore.js';

interface StoredObject {
  data: Buffer;
  metadata: ObjectMetadata;
}

export class InMemoryObjectStore implements IObjectStore {
  private readonly objects = new Map<string, StoredObject>();

  async putObject(
    key: string,
    data: Buffer | Uint8Array | string,
    options?: PutObjectOptions
  ): Promise<ObjectMetadata> {
    if (!key || typeof key !== 'string' || key.trim().length === 0) {
      throw new Error('Object key cannot be empty');
    }

    if (options?.overwrite === false && this.objects.has(key)) {
      throw new Error(`Object with key '${key}' already exists`);
    }

    const buffer = Buffer.isBuffer(data)
      ? data
      : typeof data === 'string'
        ? Buffer.from(data, 'utf8')
        : Buffer.from(data);

    const hash = options?.contentHash ?? crypto.createHash('sha256').update(buffer).digest('hex');

    const metadata: ObjectMetadata = {
      key,
      sizeBytes: buffer.byteLength,
      contentHash: hash,
      lastModified: new Date(),
      contentType: options?.contentType ?? 'application/octet-stream'
    };

    this.objects.set(key, {
      data: Buffer.from(buffer),
      metadata
    });

    return metadata;
  }

  async getObject(key: string): Promise<Buffer | undefined> {
    const item = this.objects.get(key);
    if (!item) {
      return undefined;
    }
    return Buffer.from(item.data);
  }

  async getObjectString(key: string): Promise<string | undefined> {
    const item = this.objects.get(key);
    if (!item) {
      return undefined;
    }
    return item.data.toString('utf8');
  }

  async hasObject(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async deleteObject(key: string): Promise<boolean> {
    return this.objects.delete(key);
  }

  async listObjects(prefix?: string): Promise<readonly ObjectMetadata[]> {
    const results: ObjectMetadata[] = [];
    for (const [key, item] of this.objects.entries()) {
      if (!prefix || key.startsWith(prefix)) {
        results.push({ ...item.metadata });
      }
    }
    results.sort((a, b) => a.key.localeCompare(b.key));
    return Object.freeze(results);
  }

  async checkHealth(): Promise<{
    status: 'healthy' | 'unhealthy';
    latencyMs: number;
    message?: string;
  }> {
    const start = Date.now();
    return {
      status: 'healthy',
      latencyMs: Date.now() - start
    };
  }

  clear(): void {
    this.objects.clear();
  }
}
