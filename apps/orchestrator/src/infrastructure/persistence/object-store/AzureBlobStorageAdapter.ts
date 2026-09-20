import crypto from 'node:crypto';
import type {
  IObjectStore,
  ObjectMetadata,
  PutObjectOptions
} from '../../../application/ports/persistence/IObjectStore.js';

export interface AzureBlobStorageOptions {
  readonly accountName: string;
  readonly containerName: string;
  readonly accountKey?: string;
  readonly sasToken?: string;
  readonly bearerToken?: string;
  readonly customEndpoint?: string;
}

export class AzureBlobStorageAdapter implements IObjectStore {
  private readonly accountName: string;
  private readonly containerName: string;
  private readonly accountKey?: string;
  private readonly sasToken?: string;
  private readonly bearerToken?: string;
  private readonly baseUrl: string;

  static fromEnvironment(): AzureBlobStorageAdapter {
    const accountName =
      process.env.AZURE_STORAGE_ACCOUNT_NAME ?? process.env.AZURE_STORAGE_ACCOUNT ?? '';
    const containerName =
      process.env.AZURE_STORAGE_CONTAINER_NAME ??
      process.env.AZURE_STORAGE_CONTAINER ??
      'solutions-studio';
    const accountKey = process.env.AZURE_STORAGE_KEY ?? process.env.AZURE_STORAGE_ACCOUNT_KEY;
    const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN;
    const bearerToken = process.env.AZURE_STORAGE_BEARER_TOKEN;
    const customEndpoint = process.env.AZURE_STORAGE_ENDPOINT;

    return new AzureBlobStorageAdapter({
      accountName,
      containerName,
      accountKey,
      sasToken,
      bearerToken,
      customEndpoint
    });
  }

  constructor(options: AzureBlobStorageOptions) {
    if (!options.accountName || typeof options.accountName !== 'string') {
      throw new Error('AzureBlobStorageAdapter requires accountName');
    }
    if (!options.containerName || typeof options.containerName !== 'string') {
      throw new Error('AzureBlobStorageAdapter requires containerName');
    }
    this.accountName = options.accountName;
    this.containerName = options.containerName;
    this.accountKey = options.accountKey;
    this.sasToken = options.sasToken ? options.sasToken.replace(/^\?/, '') : undefined;
    this.bearerToken = options.bearerToken;

    if (options.customEndpoint) {
      this.baseUrl = options.customEndpoint.replace(/\/$/, '');
    } else {
      this.baseUrl = `https://${this.accountName}.blob.core.windows.net`;
    }
  }

  private buildUrl(blobKey?: string, queryParams: Record<string, string> = {}): URL {
    let urlString = `${this.baseUrl}/${this.containerName}`;
    if (blobKey) {
      urlString += `/${blobKey.split('/').map(encodeURIComponent).join('/')}`;
    }
    const url = new URL(urlString);
    if (this.sasToken) {
      const sasParams = new URLSearchParams(this.sasToken);
      for (const [k, v] of sasParams.entries()) {
        url.searchParams.set(k, v);
      }
    }
    for (const [k, v] of Object.entries(queryParams)) {
      url.searchParams.set(k, v);
    }
    return url;
  }

  private buildHeaders(
    verb: string,
    url: URL,
    contentLength: number,
    contentType?: string,
    extraHeaders: Record<string, string> = {}
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'x-ms-version': '2023-11-03',
      'x-ms-date': new Date().toUTCString(),
      ...extraHeaders
    };

    if (contentType) {
      headers['Content-Type'] = contentType;
    }
    if (contentLength > 0 || ['PUT', 'POST', 'PATCH'].includes(verb)) {
      headers['Content-Length'] = String(contentLength);
    }

    if (this.bearerToken) {
      headers['Authorization'] = `Bearer ${this.bearerToken}`;
    } else if (this.accountKey) {
      const authHeader = this.computeSharedKeySignature(
        verb,
        url,
        headers,
        contentLength,
        contentType
      );
      headers['Authorization'] = authHeader;
    }

    return headers;
  }

  private computeSharedKeySignature(
    verb: string,
    url: URL,
    headers: Record<string, string>,
    contentLength: number,
    contentType?: string
  ): string {
    const msHeaders: string[] = [];
    for (const [key, value] of Object.entries(headers)) {
      const lower = key.toLowerCase();
      if (lower.startsWith('x-ms-')) {
        msHeaders.push(`${lower}:${value.trim()}`);
      }
    }
    msHeaders.sort();
    const canonicalizedHeaders = msHeaders.length > 0 ? `${msHeaders.join('\n')}\n` : '';

    const pathPart = url.pathname;
    let canonicalizedResource = `/${this.accountName}${pathPart}`;

    const searchParams = Array.from(url.searchParams.entries()).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    for (const [k, v] of searchParams) {
      if (!this.sasToken || !new URLSearchParams(this.sasToken).has(k)) {
        canonicalizedResource += `\n${k.toLowerCase()}:${v}`;
      }
    }

    const contentLenStr = contentLength > 0 ? String(contentLength) : '';
    const contentEncoding = headers['Content-Encoding'] ?? '';
    const contentLanguage = headers['Content-Language'] ?? '';
    const contentMd5 = headers['Content-MD5'] ?? '';
    const date = headers['Date'] ?? '';
    const ifModifiedSince = headers['If-Modified-Since'] ?? '';
    const ifMatch = headers['If-Match'] ?? '';
    const ifNoneMatch = headers['If-None-Match'] ?? '';
    const ifUnmodifiedSince = headers['If-Unmodified-Since'] ?? '';
    const range = headers['Range'] ?? '';

    const stringToSign = [
      verb.toUpperCase(),
      contentEncoding,
      contentLanguage,
      contentLenStr,
      contentMd5,
      contentType ?? '',
      date,
      ifModifiedSince,
      ifMatch,
      ifNoneMatch,
      ifUnmodifiedSince,
      range,
      canonicalizedHeaders + canonicalizedResource
    ].join('\n');

    const keyBuffer = Buffer.from(this.accountKey!, 'base64');
    const signature = crypto
      .createHmac('sha256', keyBuffer)
      .update(stringToSign, 'utf8')
      .digest('base64');

    return `SharedKey ${this.accountName}:${signature}`;
  }

  async putObject(
    key: string,
    data: Buffer | Uint8Array | string,
    options?: PutObjectOptions
  ): Promise<ObjectMetadata> {
    const buffer = Buffer.isBuffer(data)
      ? data
      : typeof data === 'string'
        ? Buffer.from(data, 'utf8')
        : Buffer.from(data);

    const hash = options?.contentHash ?? crypto.createHash('sha256').update(buffer).digest('hex');
    const contentType = options?.contentType ?? 'application/octet-stream';

    const url = this.buildUrl(key);
    const extraHeaders: Record<string, string> = {
      'x-ms-blob-type': 'BlockBlob',
      'x-ms-meta-contenthash': hash
    };

    if (options?.overwrite === false) {
      extraHeaders['If-None-Match'] = '*';
    }

    const headers = this.buildHeaders('PUT', url, buffer.byteLength, contentType, extraHeaders);

    const response = await fetch(url.toString(), {
      method: 'PUT',
      headers,
      body: new Uint8Array(buffer)
    });

    if (!response.ok) {
      if (response.status === 409) {
        throw new Error(
          `Object with key '${key}' already exists or conflict: ${response.statusText}`
        );
      }
      const errText = await response.text().catch(() => '');
      throw new Error(`Azure Blob Storage PUT failed (${response.status}): ${errText}`);
    }

    return {
      key,
      sizeBytes: buffer.byteLength,
      contentHash: hash,
      lastModified: new Date(),
      contentType
    };
  }

  async getObject(key: string): Promise<Buffer | undefined> {
    const url = this.buildUrl(key);
    const headers = this.buildHeaders('GET', url, 0);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers
    });

    if (response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Azure Blob Storage GET failed (${response.status}): ${errText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async getObjectString(key: string): Promise<string | undefined> {
    const buf = await this.getObject(key);
    return buf ? buf.toString('utf8') : undefined;
  }

  async hasObject(key: string): Promise<boolean> {
    const url = this.buildUrl(key);
    const headers = this.buildHeaders('HEAD', url, 0);

    const response = await fetch(url.toString(), {
      method: 'HEAD',
      headers
    });

    if (response.status === 404) {
      return false;
    }
    return response.ok;
  }

  async deleteObject(key: string): Promise<boolean> {
    const url = this.buildUrl(key);
    const headers = this.buildHeaders('DELETE', url, 0);

    const response = await fetch(url.toString(), {
      method: 'DELETE',
      headers
    });

    if (response.status === 404) {
      return false;
    }
    if (!response.ok && response.status !== 202) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Azure Blob Storage DELETE failed (${response.status}): ${errText}`);
    }
    return true;
  }

  async listObjects(prefix?: string): Promise<readonly ObjectMetadata[]> {
    const queryParams: Record<string, string> = {
      restype: 'container',
      comp: 'list'
    };
    if (prefix) {
      queryParams['prefix'] = prefix;
    }

    const url = this.buildUrl(undefined, queryParams);
    const headers = this.buildHeaders('GET', url, 0);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Azure Blob Storage LIST failed (${response.status}): ${errText}`);
    }

    const xmlText = await response.text();
    const results: ObjectMetadata[] = [];

    // Parse blob items from XML without external parser
    const blobMatches = xmlText.match(/<Blob>[\s\S]*?<\/Blob>/g) ?? [];
    for (const blobXml of blobMatches) {
      const nameMatch = blobXml.match(/<Name>(.*?)<\/Name>/);
      const sizeMatch = blobXml.match(/<Content-Length>(.*?)<\/Content-Length>/);
      const modMatch = blobXml.match(/<Last-Modified>(.*?)<\/Last-Modified>/);
      const typeMatch = blobXml.match(/<Content-Type>(.*?)<\/Content-Type>/);
      const metaHashMatch = blobXml.match(/<contenthash>(.*?)<\/contenthash>/i);

      if (nameMatch && nameMatch[1]) {
        const key = decodeURIComponent(nameMatch[1]);
        const sizeBytes = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;
        const lastModified = modMatch ? new Date(modMatch[1]) : new Date();
        const contentType = typeMatch ? typeMatch[1] : undefined;
        const contentHash = metaHashMatch ? metaHashMatch[1] : '';

        results.push({
          key,
          sizeBytes,
          contentHash,
          lastModified,
          contentType
        });
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
    try {
      const url = this.buildUrl(undefined, { restype: 'container' });
      const headers = this.buildHeaders('HEAD', url, 0);
      const response = await fetch(url.toString(), {
        method: 'HEAD',
        headers
      });
      const latencyMs = Date.now() - start;
      if (response.ok) {
        return { status: 'healthy', latencyMs };
      } else {
        return {
          status: 'unhealthy',
          latencyMs,
          message: `Health check returned HTTP ${response.status}`
        };
      }
    } catch (err) {
      return {
        status: 'unhealthy',
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : String(err)
      };
    }
  }
}
