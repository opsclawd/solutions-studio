export interface StorageComponentHealth {
  readonly status: 'healthy' | 'unhealthy';
  readonly latencyMs: number;
  readonly message?: string;
  readonly details?: Record<string, unknown>;
}

export interface StorageHealthReport {
  readonly status: 'healthy' | 'unhealthy';
  readonly timestamp: string;
  readonly database?: StorageComponentHealth;
  readonly objectStore?: StorageComponentHealth;
}

export interface IStorageHealthCheck {
  checkHealth(): Promise<StorageHealthReport>;
}
