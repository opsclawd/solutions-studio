export interface ObjectMetadata {
  readonly key: string;
  readonly sizeBytes: number;
  readonly contentHash: string;
  readonly lastModified: Date;
  readonly contentType?: string;
}

export interface PutObjectOptions {
  readonly contentType?: string;
  readonly contentHash?: string;
  readonly overwrite?: boolean;
}

export interface IObjectStore {
  putObject(
    key: string,
    data: Buffer | Uint8Array | string,
    options?: PutObjectOptions
  ): Promise<ObjectMetadata>;
  getObject(key: string): Promise<Buffer | undefined>;
  getObjectString(key: string): Promise<string | undefined>;
  hasObject(key: string): Promise<boolean>;
  deleteObject(key: string): Promise<boolean>;
  listObjects(prefix?: string): Promise<readonly ObjectMetadata[]>;
  checkHealth(): Promise<{ status: 'healthy' | 'unhealthy'; latencyMs: number; message?: string }>;
}
