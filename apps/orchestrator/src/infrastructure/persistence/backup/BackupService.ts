import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ISqlDatabaseClient } from '../../../application/ports/persistence/ISqlDatabaseClient.js';
import type { IObjectStore } from '../../../application/ports/persistence/IObjectStore.js';

export interface BackupOptions {
  readonly db: ISqlDatabaseClient;
  readonly objectStore: IObjectStore;
  readonly targetDir: string;
  readonly timestamp?: string;
}

export interface BackupTableManifest {
  readonly count: number;
  readonly sha256: string;
}

export interface BackupBlobManifest {
  readonly key: string;
  readonly size: number;
  readonly sha256: string;
}

export interface BackupManifest {
  readonly version: string;
  readonly timestamp: string;
  readonly tables: Record<string, BackupTableManifest>;
  readonly blobs: readonly BackupBlobManifest[];
  readonly sha256Attestation: string;
}

export const BACKUP_TABLES = [
  'schema_migrations',
  'sources',
  'source_revisions',
  'requirements',
  'requirement_revisions',
  'candidate_findings',
  'reconciliation_records',
  'baselines',
  'policy_constraints',
  'policy_constraint_revisions',
  'engineering_decisions',
  'projections',
  'stories',
  'evaluation_runs',
  'validation_runs',
  'governance_approvals'
] as const;

export function resolveSafeBlobPath(baseDir: string, key: string): string {
  if (!key || typeof key !== 'string' || path.isAbsolute(key)) {
    throw new Error(`Invalid blob key: '${key}'`);
  }
  const resolved = path.resolve(baseDir, key);
  const relative = path.relative(baseDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path traversal detected for blob key: '${key}'`);
  }
  return resolved;
}

export class BackupService {
  private readonly db: ISqlDatabaseClient;
  private readonly objectStore: IObjectStore;
  private readonly targetDir: string;
  private readonly timestamp: string;

  constructor(options: BackupOptions) {
    this.db = options.db;
    this.objectStore = options.objectStore;
    this.targetDir = options.targetDir;
    this.timestamp = options.timestamp ?? new Date().toISOString();
  }

  async createBackup(): Promise<BackupManifest> {
    const tablesDir = path.join(this.targetDir, 'tables');
    const blobsDir = path.join(this.targetDir, 'blobs');

    await fs.mkdir(tablesDir, { recursive: true });
    await fs.mkdir(blobsDir, { recursive: true });

    // 1. Export database tables within a single snapshot transaction
    const tableManifests: Record<string, BackupTableManifest> = {};

    await this.db.transaction(async (tx) => {
      for (const tableName of BACKUP_TABLES) {
        const res = await tx.query<Record<string, unknown>>(
          `SELECT * FROM ${tableName} ORDER BY 1 ASC;`
        );
        const rows = res.rows;
        const jsonText = JSON.stringify(rows, null, 2);
        const sha256 = crypto.createHash('sha256').update(jsonText).digest('hex');

        await fs.writeFile(path.join(tablesDir, `${tableName}.json`), jsonText, 'utf8');

        tableManifests[tableName] = {
          count: rows.length,
          sha256
        };
      }
    });

    // 2. Export blob store items with containment verification
    const blobItems = await this.objectStore.listObjects();
    const blobManifests: BackupBlobManifest[] = [];

    for (const item of blobItems) {
      const key = item.key;
      const buf = await this.objectStore.getObject(key);
      if (buf) {
        const destPath = resolveSafeBlobPath(blobsDir, key);
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.writeFile(destPath, buf);

        const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
        blobManifests.push({
          key,
          size: buf.byteLength,
          sha256
        });
      }
    }

    // 3. Generate signed / checksum manifest
    const manifestPayload = {
      version: '1.0',
      timestamp: this.timestamp,
      tables: tableManifests,
      blobs: blobManifests
    };

    const sha256Attestation = crypto
      .createHash('sha256')
      .update(JSON.stringify(manifestPayload))
      .digest('hex');

    const manifest: BackupManifest = {
      ...manifestPayload,
      sha256Attestation
    };

    await fs.writeFile(
      path.join(this.targetDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );

    return manifest;
  }
}
