import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { ISqlDatabaseClient } from '../../../application/ports/persistence/ISqlDatabaseClient.js';
import type { IObjectStore } from '../../../application/ports/persistence/IObjectStore.js';
import type { IRequirementsRepository } from '../../../application/ports/persistence/IRequirementsRepository.js';
import { type BackupManifest, resolveSafeBlobPath } from './BackupService.js';
import {
  createRequirementRevisionId,
  createSourceRevisionId,
  createStoryId,
  createRequirementsBaselineId
} from '@solutions-studio/domain';

export interface RestoreOptions {
  readonly db: ISqlDatabaseClient;
  readonly objectStore: IObjectStore;
  readonly backupDir: string;
  readonly repo: IRequirementsRepository;
}

export interface RestoreVerificationResult {
  readonly verified: boolean;
  readonly checksumsVerified: boolean;
  readonly baselineCount: number;
  readonly verifiedBaselines: readonly string[];
  readonly verifiedSourceRevisions: readonly string[];
  readonly verifiedProjections: readonly string[];
  readonly verifiedStories: readonly string[];
  readonly errors: readonly string[];
}

export class BackupChecksumMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupChecksumMismatchError';
  }
}

export class RestoreService {
  private readonly db: ISqlDatabaseClient;
  private readonly objectStore: IObjectStore;
  private readonly backupDir: string;
  private readonly repo: IRequirementsRepository;

  constructor(options: RestoreOptions) {
    this.db = options.db;
    this.objectStore = options.objectStore;
    this.backupDir = options.backupDir;
    this.repo = options.repo;
  }

  private async readManifest(): Promise<BackupManifest> {
    const manifestPath = path.join(this.backupDir, 'manifest.json');
    const text = await fs.readFile(manifestPath, 'utf8');
    return JSON.parse(text) as BackupManifest;
  }

  async verifyBackupIntegrity(): Promise<void> {
    const manifest = await this.readManifest();

    // 0. Verify manifest sha256Attestation
    const manifestPayload = {
      version: manifest.version,
      timestamp: manifest.timestamp,
      tables: manifest.tables,
      blobs: manifest.blobs
    };
    const computedAttestation = crypto
      .createHash('sha256')
      .update(JSON.stringify(manifestPayload))
      .digest('hex');
    if (computedAttestation !== manifest.sha256Attestation) {
      throw new BackupChecksumMismatchError(
        `Manifest attestation mismatch: expected '${manifest.sha256Attestation}', actual '${computedAttestation}'`
      );
    }

    // 1. Verify tables checksums and row counts
    for (const [tableName, meta] of Object.entries(manifest.tables)) {
      const tableFile = path.join(this.backupDir, 'tables', `${tableName}.json`);
      let text: string;
      try {
        text = await fs.readFile(tableFile, 'utf8');
      } catch (err) {
        throw new BackupChecksumMismatchError(
          `Backup table file missing for '${tableName}': ${(err as Error).message}`
        );
      }
      const actualSha256 = crypto.createHash('sha256').update(text).digest('hex');
      if (actualSha256 !== meta.sha256) {
        throw new BackupChecksumMismatchError(
          `Checksum mismatch for table '${tableName}': expected '${meta.sha256}', actual '${actualSha256}'`
        );
      }
      const parsedRows = JSON.parse(text);
      if (!Array.isArray(parsedRows) || parsedRows.length !== meta.count) {
        throw new BackupChecksumMismatchError(
          `Row count mismatch for table '${tableName}': expected ${meta.count}, actual ${parsedRows?.length}`
        );
      }
    }

    // 2. Verify blobs checksums and sizes with containment check
    for (const blobMeta of manifest.blobs) {
      const blobFile = resolveSafeBlobPath(path.join(this.backupDir, 'blobs'), blobMeta.key);
      let buf: Buffer;
      try {
        buf = await fs.readFile(blobFile);
      } catch (err) {
        throw new BackupChecksumMismatchError(
          `Backup blob file missing for '${blobMeta.key}': ${(err as Error).message}`
        );
      }
      const actualSha256 = crypto.createHash('sha256').update(buf).digest('hex');
      if (actualSha256 !== blobMeta.sha256) {
        throw new BackupChecksumMismatchError(
          `Checksum mismatch for blob '${blobMeta.key}': expected '${blobMeta.sha256}', actual '${actualSha256}'`
        );
      }
      if (buf.byteLength !== blobMeta.size) {
        throw new BackupChecksumMismatchError(
          `Size mismatch for blob '${blobMeta.key}': expected ${blobMeta.size} bytes, actual ${buf.byteLength} bytes`
        );
      }
    }
  }

  async restore(): Promise<RestoreVerificationResult> {
    // Step 1: Pre-restore verification
    let integrityVerified = false;
    await this.verifyBackupIntegrity();
    integrityVerified = true;
    const manifest = await this.readManifest();

    // Step 2: Phase 1 - Restore Blobs to ObjectStore (with containment and integrity verification)
    for (const blobMeta of manifest.blobs) {
      const blobFile = resolveSafeBlobPath(path.join(this.backupDir, 'blobs'), blobMeta.key);
      const buf = await fs.readFile(blobFile);
      await this.objectStore.putObject(blobMeta.key, buf);
    }

    // Step 3: Phase 2 - Restore Relational Database within a transaction
    // Truncate / delete all tables in reverse order
    await this.db.transaction(async (tx) => {
      await tx.exec(`
        DELETE FROM evaluation_runs;
        DELETE FROM stories;
        DELETE FROM projections;
        DELETE FROM engineering_decisions;
        DELETE FROM policy_constraint_revisions;
        DELETE FROM policy_constraints;
        DELETE FROM baselines;
        DELETE FROM reconciliation_records;
        DELETE FROM candidate_findings;
        DELETE FROM requirement_revisions;
        DELETE FROM requirements;
        DELETE FROM source_revisions;
        DELETE FROM sources;
        DELETE FROM schema_migrations;
      `);

      const tablesDir = path.join(this.backupDir, 'tables');

      // Helper to read table rows
      const loadRows = async (name: string): Promise<Record<string, unknown>[]> => {
        const p = path.join(tablesDir, `${name}.json`);
        try {
          const content = await fs.readFile(p, 'utf8');
          return JSON.parse(content) as Record<string, unknown>[];
        } catch {
          return [];
        }
      };

      // Helper to format jsonb columns
      const jsonCol = (val: unknown) =>
        val !== null && val !== undefined
          ? typeof val === 'object'
            ? JSON.stringify(val)
            : val
          : null;

      // 1. schema_migrations
      for (const row of await loadRows('schema_migrations')) {
        await tx.query(
          `INSERT INTO schema_migrations (version, name, checksum, applied_at)
           VALUES ($1, $2, $3, $4);`,
          [row.version, row.name, row.checksum, row.applied_at]
        );
      }

      // 2. sources
      for (const row of await loadRows('sources')) {
        await tx.query(`INSERT INTO sources (id, source_type) VALUES ($1, $2);`, [
          row.id,
          row.source_type
        ]);
      }

      // 3. source_revisions
      for (const row of await loadRows('source_revisions')) {
        await tx.query(
          `INSERT INTO source_revisions (
             id, source_id, revision, content_hash, captured_at, verified_at,
             supersedes, source_type, raw_text, payload_ref, locator_index
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);`,
          [
            row.id,
            row.source_id,
            row.revision,
            row.content_hash,
            row.captured_at,
            row.verified_at ?? null,
            row.supersedes ?? null,
            row.source_type ?? null,
            row.raw_text,
            row.payload_ref ?? null,
            jsonCol(row.locator_index)
          ]
        );
      }

      // 4. requirements
      for (const row of await loadRows('requirements')) {
        await tx.query(`INSERT INTO requirements (id) VALUES ($1);`, [row.id]);
      }

      // 5. requirement_revisions
      for (const row of await loadRows('requirement_revisions')) {
        await tx.query(
          `INSERT INTO requirement_revisions (
             id, requirement_id, revision, statement, category, origin,
             review_state, resolution_state, evidence, rationale, actor_id,
             baseline_id, originating_projection_id, affected_actors, dependencies, supersedes
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16);`,
          [
            row.id,
            row.requirement_id,
            row.revision,
            row.statement,
            row.category,
            row.origin,
            row.review_state,
            row.resolution_state,
            jsonCol(row.evidence),
            row.rationale,
            row.actor_id ?? null,
            row.baseline_id ?? null,
            row.originating_projection_id ?? null,
            jsonCol(row.affected_actors),
            jsonCol(row.dependencies),
            row.supersedes ?? null
          ]
        );
      }

      // 6. candidate_findings
      for (const row of await loadRows('candidate_findings')) {
        await tx.query(
          `INSERT INTO candidate_findings (
             id, type, affected_requirement_revisions, evidence, discovered_by,
             disposition, rationale, actor_id, baseline_id, originating_projection_id, version
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);`,
          [
            row.id,
            row.type,
            jsonCol(row.affected_requirement_revisions),
            jsonCol(row.evidence),
            row.discovered_by,
            row.disposition,
            row.rationale ?? null,
            row.actor_id ?? null,
            row.baseline_id ?? null,
            row.originating_projection_id ?? null,
            row.version ?? 1
          ]
        );
      }

      // 7. reconciliation_records
      for (const row of await loadRows('reconciliation_records')) {
        await tx.query(
          `INSERT INTO reconciliation_records (
             id, entity_type, entity_id, requirement_revision_id, action,
             previous_review_state, new_review_state, previous_resolution_state,
             new_resolution_state, previous_disposition, new_disposition,
             rationale, actor_id, recorded_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14);`,
          [
            row.id,
            row.entity_type,
            row.entity_id,
            row.requirement_revision_id ?? null,
            row.action ?? null,
            row.previous_review_state ?? null,
            row.new_review_state ?? null,
            row.previous_resolution_state ?? null,
            row.new_resolution_state ?? null,
            row.previous_disposition ?? null,
            row.new_disposition ?? null,
            row.rationale,
            row.actor_id ?? null,
            row.recorded_at
          ]
        );
      }

      // 8. baselines
      for (const row of await loadRows('baselines')) {
        await tx.query(
          `INSERT INTO baselines (
             id, requirement_revisions, policy_constraint_revisions, created_at, created_by
           ) VALUES ($1, $2, $3, $4, $5);`,
          [
            row.id,
            jsonCol(row.requirement_revisions),
            jsonCol(row.policy_constraint_revisions),
            row.created_at,
            row.created_by
          ]
        );
      }

      // 9. policy_constraints
      for (const row of await loadRows('policy_constraints')) {
        await tx.query(`INSERT INTO policy_constraints (id) VALUES ($1);`, [row.id]);
      }

      // 10. policy_constraint_revisions
      for (const row of await loadRows('policy_constraint_revisions')) {
        await tx.query(
          `INSERT INTO policy_constraint_revisions (
             id, policy_constraint_id, revision, statement, authority_reference,
             state, created_at, created_by, supersedes
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`,
          [
            row.id,
            row.policy_constraint_id,
            row.revision,
            row.statement,
            row.authority_reference,
            row.state,
            row.created_at,
            row.created_by,
            row.supersedes ?? null
          ]
        );
      }

      // 11. engineering_decisions
      for (const row of await loadRows('engineering_decisions')) {
        await tx.query(
          `INSERT INTO engineering_decisions (
             id, baseline_id, statement, rationale, requirement_revision_ids,
             policy_constraint_revision_ids, state, created_at, created_by,
             accepted_by, accepted_at, supersedes, transition_rationale, version
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14);`,
          [
            row.id,
            row.baseline_id,
            row.statement,
            row.rationale,
            jsonCol(row.requirement_revision_ids),
            jsonCol(row.policy_constraint_revision_ids),
            row.state,
            row.created_at,
            row.created_by,
            row.accepted_by ?? null,
            row.accepted_at ?? null,
            row.supersedes ?? null,
            row.transition_rationale ?? null,
            row.version ?? 1
          ]
        );
      }

      // 12. projections
      for (const row of await loadRows('projections')) {
        await tx.query(
          `INSERT INTO projections (
             id, baseline_id, requirement_revision_ids, policy_constraint_revision_ids,
             engineering_decision_ids, artifact_type, content, payload_ref, metadata,
             created_at, version
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);`,
          [
            row.id,
            row.baseline_id,
            jsonCol(row.requirement_revision_ids),
            jsonCol(row.policy_constraint_revision_ids),
            jsonCol(row.engineering_decision_ids),
            row.artifact_type,
            row.content,
            row.payload_ref ?? null,
            jsonCol(row.metadata),
            row.created_at,
            row.version ?? 1
          ]
        );
      }

      // 13. stories
      for (const row of await loadRows('stories')) {
        await tx.query(
          `INSERT INTO stories (
             id, baseline_id, projection_id, title, narrative, requirement_revision_ids,
             policy_constraint_revision_ids, scenarios, acceptance_criteria, gherkin_text,
             metadata, created_at, dependencies, version
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14);`,
          [
            row.id,
            row.baseline_id,
            row.projection_id,
            row.title,
            jsonCol(row.narrative),
            jsonCol(row.requirement_revision_ids),
            jsonCol(row.policy_constraint_revision_ids),
            jsonCol(row.scenarios),
            jsonCol(row.acceptance_criteria),
            row.gherkin_text ?? '',
            jsonCol(row.metadata),
            row.created_at,
            jsonCol(row.dependencies),
            row.version ?? 1
          ]
        );
      }

      // 14. evaluation_runs
      for (const row of await loadRows('evaluation_runs')) {
        await tx.query(
          `INSERT INTO evaluation_runs (
             id, corpus_version, executed_at, fixture_results, report, payload_ref
           ) VALUES ($1, $2, $3, $4, $5, $6);`,
          [
            row.id,
            row.corpus_version,
            row.executed_at,
            jsonCol(row.fixture_results),
            jsonCol(row.report),
            row.payload_ref ?? null
          ]
        );
      }
    });

    // Step 4: Post-Restore Verification
    const errors: string[] = [];
    const verifiedBaselines: string[] = [];
    const verifiedSourceRevisions: string[] = [];
    const verifiedProjections: string[] = [];
    const verifiedStories: string[] = [];

    try {
      // Verify table row counts match manifest counts
      for (const [tableName, meta] of Object.entries(manifest.tables)) {
        const countRes = await this.db.query<{ count: string | number }>(
          `SELECT COUNT(*) as count FROM ${tableName};`
        );
        const actualCount = Number(countRes.rows[0]?.count ?? 0);
        if (actualCount !== meta.count) {
          errors.push(
            `Table '${tableName}' row count mismatch after restore: expected ${meta.count}, actual ${actualCount}`
          );
        }
      }

      // Verify baselines and exact manifest lineage
      const baselinesTableFile = path.join(this.backupDir, 'tables', 'baselines.json');
      const manifestBaselines: {
        id: string;
        requirement_revisions: string | string[];
        policy_constraint_revisions?: string | string[];
      }[] = JSON.parse(await fs.readFile(baselinesTableFile, 'utf8'));

      for (const mb of manifestBaselines) {
        verifiedBaselines.push(mb.id);
        const baseline = await this.repo.getRequirementsBaseline(
          createRequirementsBaselineId(mb.id)
        );
        if (!baseline) {
          errors.push(`Baseline '${mb.id}' from manifest not found after restore`);
          continue;
        }
        const expectedReqs: string[] =
          typeof mb.requirement_revisions === 'string'
            ? JSON.parse(mb.requirement_revisions)
            : mb.requirement_revisions;
        if (JSON.stringify(baseline.requirementRevisions) !== JSON.stringify(expectedReqs)) {
          errors.push(`Baseline '${mb.id}' requirementRevisions mismatch from backup manifest`);
        }
        for (const reqRevId of baseline.requirementRevisions) {
          const rev = await this.repo.getRequirementRevision(createRequirementRevisionId(reqRevId));
          if (!rev) {
            errors.push(
              `Baseline '${baseline.id}' requirement revision '${reqRevId}' not found after restore`
            );
          }
        }
      }

      // Verify sources, content hashes, and locator indexes
      const sourceRevisionsTableFile = path.join(this.backupDir, 'tables', 'source_revisions.json');
      let manifestSourceRevisions: { id: string; locator_index?: unknown }[] = [];
      try {
        manifestSourceRevisions = JSON.parse(await fs.readFile(sourceRevisionsTableFile, 'utf8'));
      } catch {
        // ignore if not present
      }
      const backupLocatorMap = new Map<string, unknown>();
      for (const msr of manifestSourceRevisions) {
        const loc =
          typeof msr.locator_index === 'string' ? JSON.parse(msr.locator_index) : msr.locator_index;
        backupLocatorMap.set(msr.id, loc ?? []);
      }

      const sourcesRes = await this.db.query<{ id: string; content_hash: string }>(
        `SELECT id, content_hash FROM source_revisions ORDER BY id ASC;`
      );
      for (const s of sourcesRes.rows) {
        const sr = await this.repo.getSourceRevision(createSourceRevisionId(s.id));
        if (!sr) {
          errors.push(`Source revision '${s.id}' not found after restore`);
        } else {
          const recomputed = crypto.createHash('sha256').update(sr.rawText).digest('hex');
          if (recomputed !== s.content_hash || recomputed !== sr.revision.contentHash) {
            errors.push(
              `Source revision '${s.id}' content hash mismatch: expected '${s.content_hash}', computed '${recomputed}'`
            );
          } else {
            verifiedSourceRevisions.push(s.id);
          }
          if (!Array.isArray(sr.locatorIndex)) {
            errors.push(`Source revision '${s.id}' locator index is not an array`);
          } else if (backupLocatorMap.has(s.id)) {
            const expectedLocatorIndex = backupLocatorMap.get(s.id);
            if (!isDeepStrictEqual(sr.locatorIndex, expectedLocatorIndex)) {
              errors.push(`Source revision '${s.id}' locator index mismatch against backup table`);
            }
          }
        }
      }

      // Verify projections and content integrity
      const blobManifestMap = new Map<string, { sha256: string; size: number }>();
      for (const b of manifest.blobs) {
        blobManifestMap.set(b.key, b);
      }

      const projRes = await this.db.query<{
        id: string;
        content: string;
        payload_ref?: string | null;
      }>(`SELECT id, content, payload_ref FROM projections ORDER BY id ASC;`);
      for (const p of projRes.rows) {
        const pr = await this.repo.getProjectionRecord(p.id);
        if (!pr) {
          errors.push(`Projection '${p.id}' not found after restore`);
        } else {
          if (pr.content !== p.content) {
            errors.push(`Projection '${p.id}' content mismatch after restore`);
          } else {
            verifiedProjections.push(p.id);
          }

          // Verify projection content hash against blob manifest
          const blobKey = p.payload_ref || `projections/${p.id}.artifact`;
          const blobMeta = blobManifestMap.get(blobKey);
          if (blobMeta) {
            const actualSha256 = crypto.createHash('sha256').update(pr.content).digest('hex');
            if (actualSha256 !== blobMeta.sha256) {
              errors.push(
                `Projection '${p.id}' content hash mismatch against blob manifest '${blobKey}': expected '${blobMeta.sha256}', actual '${actualSha256}'`
              );
            }
          }
        }
      }

      // Verify stories
      const storyRes = await this.db.query<{ id: string }>(
        `SELECT id FROM stories ORDER BY id ASC;`
      );
      for (const st of storyRes.rows) {
        const story = await this.repo.getStory(createStoryId(st.id));
        if (!story) {
          errors.push(`Story '${st.id}' not found after restore`);
        } else {
          verifiedStories.push(st.id);
        }
      }
    } catch (err) {
      errors.push(`Post-restore verification error: ${(err as Error).message}`);
    }

    const verified = integrityVerified && errors.length === 0;

    return {
      verified,
      checksumsVerified: integrityVerified && errors.length === 0,
      baselineCount: verifiedBaselines.length,
      verifiedBaselines,
      verifiedSourceRevisions,
      verifiedProjections,
      verifiedStories,
      errors
    };
  }
}
