import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  IRequirementsRepository,
  SourceRevisionRecord,
  ReconciliationRecord,
  ProjectionRecord,
  StoryRecord,
  EvaluationRunRecord
} from '../../../application/ports/persistence/IRequirementsRepository.js';
import type { IObjectStore } from '../../../application/ports/persistence/IObjectStore.js';
import type { ISqlDatabaseClient } from '../../../application/ports/persistence/ISqlDatabaseClient.js';
import {
  createRequirementRevisionId,
  type RequirementRevision,
  type CandidateFinding,
  type RequirementsBaseline,
  type PolicyConstraintRevision,
  type EngineeringDecision
} from '@solutions-studio/domain';
import { computeContentHash } from '../markdown/deriveLocatorIndex.js';

export interface LocalStoreMigrationOptions {
  readonly sourceDir: string;
  readonly targetRepo: IRequirementsRepository;
  readonly targetDb: ISqlDatabaseClient;
  readonly targetObjectStore: IObjectStore;
  readonly dryRun?: boolean;
}

export interface MigrationAttestationReport {
  readonly timestamp: string;
  readonly sourceDir: string;
  readonly dryRun: boolean;
  readonly recordCounts: {
    sources: number;
    sourceRevisions: number;
    requirements: number;
    requirementRevisions: number;
    findings: number;
    reconciliationRecords: number;
    baselines: number;
    policyConstraints: number;
    policyConstraintRevisions: number;
    engineeringDecisions: number;
    projections: number;
    stories: number;
    evaluationRuns: number;
  };
  readonly verified: boolean;
  readonly baselineVerification: readonly {
    baselineId: string;
    requirementRevisionCount: number;
    verified: boolean;
  }[];
  readonly sha256Attestation: string;
}

export class LocalStoreMigrationService {
  private readonly sourceDir: string;
  private readonly targetRepo: IRequirementsRepository;
  private readonly targetDb: ISqlDatabaseClient;
  private readonly targetObjectStore: IObjectStore;
  private readonly dryRun: boolean;

  constructor(options: LocalStoreMigrationOptions) {
    this.sourceDir = options.sourceDir;
    this.targetRepo = options.targetRepo;
    this.targetDb = options.targetDb;
    this.targetObjectStore = options.targetObjectStore;
    this.dryRun = options.dryRun ?? false;
  }

  private async readJsonFile<T>(filePath: string): Promise<T | undefined> {
    try {
      const text = await fs.readFile(filePath, 'utf8');
      return JSON.parse(text) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw err;
    }
  }

  private async listJsonFiles(subDir: string): Promise<string[]> {
    const dir = path.join(this.sourceDir, subDir);
    try {
      const entries = await fs.readdir(dir);
      return entries
        .filter((f) => f.endsWith('.json'))
        .map((f) => path.join(dir, f))
        .sort();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  private async listJsonlFiles(subDir: string): Promise<string[]> {
    const dir = path.join(this.sourceDir, subDir);
    try {
      const entries = await fs.readdir(dir);
      return entries
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => path.join(dir, f))
        .sort();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  async migrate(): Promise<MigrationAttestationReport> {
    const counts = {
      sources: 0,
      sourceRevisions: 0,
      requirements: 0,
      requirementRevisions: 0,
      findings: 0,
      reconciliationRecords: 0,
      baselines: 0,
      policyConstraints: 0,
      policyConstraintRevisions: 0,
      engineeringDecisions: 0,
      projections: 0,
      stories: 0,
      evaluationRuns: 0
    };

    // 1. Sources & Source Revisions
    const sourceRevFiles = await this.listJsonFiles('source-revisions');
    for (const file of sourceRevFiles) {
      const rec = await this.readJsonFile<SourceRevisionRecord>(file);
      if (rec?.revision) {
        counts.sourceRevisions++;
        const contentHash = computeContentHash(rec.rawText ?? '');
        if (rec.revision.contentHash !== contentHash) {
          throw new Error(
            `Source revision '${rec.revision.id}' content hash mismatch during migration: recorded '${rec.revision.contentHash}', calculated '${contentHash}'`
          );
        }
        if (!this.dryRun) {
          const blobKey = `sources/${rec.revision.sourceId}/${rec.revision.id}.md`;
          await this.targetObjectStore.putObject(blobKey, rec.rawText ?? '', {
            contentType: 'text/markdown',
            contentHash
          });
          await this.targetDb.query(
            `INSERT INTO sources (id, source_type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING;`,
            [rec.revision.sourceId, rec.sourceType ?? 'sop']
          );
          await this.targetDb.query(
            `INSERT INTO source_revisions (
               id, source_id, revision, content_hash, captured_at, verified_at,
               supersedes, source_type, raw_text, payload_ref, locator_index
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (id) DO NOTHING;`,
            [
              rec.revision.id,
              rec.revision.sourceId,
              rec.revision.revision,
              contentHash,
              rec.revision.capturedAt,
              rec.revision.verifiedAt ?? null,
              rec.revision.supersedes ?? null,
              rec.sourceType ?? null,
              rec.rawText,
              blobKey,
              JSON.stringify(rec.locatorIndex ?? [])
            ]
          );
        }
      }
    }
    const sourceIndexFiles = await this.listJsonFiles('source-index');
    counts.sources = sourceIndexFiles.length;

    // 2. Requirements & Requirement Revisions
    const reqRevFiles = await this.listJsonFiles('requirement-revisions');
    for (const file of reqRevFiles) {
      const rev = await this.readJsonFile<RequirementRevision>(file);
      if (rev?.id) {
        counts.requirementRevisions++;
        if (!this.dryRun) {
          await this.targetDb.query(
            `INSERT INTO requirements (id) VALUES ($1) ON CONFLICT (id) DO NOTHING;`,
            [rev.requirementId]
          );
          await this.targetDb.query(
            `INSERT INTO requirement_revisions (
               id, requirement_id, revision, statement, category, origin,
               review_state, resolution_state, evidence, rationale, actor_id,
               baseline_id, originating_projection_id, affected_actors,
               dependencies, supersedes
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
             ON CONFLICT (id) DO NOTHING;`,
            [
              rev.id,
              rev.requirementId,
              rev.revision,
              rev.statement,
              rev.category,
              rev.origin,
              rev.reviewState,
              rev.resolutionState,
              JSON.stringify(rev.evidence ?? []),
              rev.rationale,
              rev.actorId ?? null,
              rev.baselineId ?? null,
              rev.originatingProjectionId ?? null,
              rev.affectedActors ? JSON.stringify(rev.affectedActors) : null,
              rev.dependencies ? JSON.stringify(rev.dependencies) : null,
              rev.supersedes ?? null
            ]
          );
        }
      }
    }
    const reqIndexFiles = await this.listJsonFiles('requirement-index');
    counts.requirements = reqIndexFiles.length;

    // 3. Candidate Findings
    const findingFiles = await this.listJsonFiles('findings');
    for (const file of findingFiles) {
      const finding = await this.readJsonFile<CandidateFinding>(file);
      if (finding?.id) {
        counts.findings++;
        if (!this.dryRun) {
          await this.targetDb.query(
            `INSERT INTO candidate_findings (
               id, type, affected_requirement_revisions, evidence, discovered_by,
               disposition, rationale, actor_id, baseline_id, originating_projection_id, version
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1)
             ON CONFLICT (id) DO NOTHING;`,
            [
              finding.id,
              finding.type,
              JSON.stringify(finding.affectedRequirementRevisions ?? []),
              JSON.stringify(finding.evidence ?? []),
              finding.discoveredBy,
              finding.disposition,
              finding.rationale,
              finding.actorId ?? null,
              finding.baselineId ?? null,
              finding.originatingProjectionId ?? null
            ]
          );
        }
      }
    }

    // 4. Reconciliation Records
    const reconFiles = await this.listJsonlFiles('reconciliation');
    for (const file of reconFiles) {
      if (file.endsWith('.jsonl')) {
        const text = await fs.readFile(file, 'utf8');
        const lines = text.split('\n').filter((l) => l.trim().length > 0);
        for (const line of lines) {
          const rec = JSON.parse(line) as ReconciliationRecord;
          counts.reconciliationRecords++;
          if (!this.dryRun) {
            if (rec.entityType === 'finding') {
              await this.targetDb.query(
                `INSERT INTO reconciliation_records (
                   id, entity_type, entity_id, requirement_revision_id, action,
                   previous_review_state, new_review_state, previous_resolution_state,
                   new_resolution_state, previous_disposition, new_disposition,
                   rationale, actor_id, recorded_at
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                 ON CONFLICT (id) DO NOTHING;`,
                [
                  rec.id,
                  rec.entityType,
                  rec.entityId,
                  null,
                  null,
                  null,
                  null,
                  null,
                  null,
                  rec.previousDisposition ?? null,
                  rec.newDisposition,
                  rec.rationale,
                  rec.actorId ?? null,
                  rec.recordedAt
                ]
              );
            } else {
              await this.targetDb.query(
                `INSERT INTO reconciliation_records (
                   id, entity_type, entity_id, requirement_revision_id, action,
                   previous_review_state, new_review_state, previous_resolution_state,
                   new_resolution_state, previous_disposition, new_disposition,
                   rationale, actor_id, recorded_at
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                 ON CONFLICT (id) DO NOTHING;`,
                [
                  rec.id,
                  rec.entityType,
                  rec.entityId,
                  rec.requirementRevisionId,
                  rec.action,
                  rec.previousReviewState ?? null,
                  rec.newReviewState,
                  rec.previousResolutionState ?? null,
                  rec.newResolutionState ?? null,
                  null,
                  null,
                  rec.rationale,
                  rec.actorId ?? null,
                  rec.recordedAt
                ]
              );
            }
          }
        }
      }
    }

    // 5. Baselines
    const baselineFiles = await this.listJsonFiles('baselines');
    for (const file of baselineFiles) {
      const b = await this.readJsonFile<RequirementsBaseline>(file);
      if (b?.id) {
        counts.baselines++;
        if (!this.dryRun) {
          await this.targetDb.query(
            `INSERT INTO baselines (
               id, requirement_revisions, policy_constraint_revisions, created_at, created_by
             ) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO NOTHING;`,
            [
              b.id,
              JSON.stringify(b.requirementRevisions ?? []),
              JSON.stringify(b.policyConstraintRevisions ?? []),
              b.createdAt,
              b.createdBy
            ]
          );
        }
      }
    }

    // 6. Policy Constraints & Revisions
    const polRevFiles = await this.listJsonFiles('policy-constraint-revisions');
    for (const file of polRevFiles) {
      const p = await this.readJsonFile<PolicyConstraintRevision>(file);
      if (p?.id) {
        counts.policyConstraintRevisions++;
        if (!this.dryRun) {
          await this.targetDb.query(
            `INSERT INTO policy_constraints (id) VALUES ($1) ON CONFLICT (id) DO NOTHING;`,
            [p.policyConstraintId]
          );
          await this.targetDb.query(
            `INSERT INTO policy_constraint_revisions (
               id, policy_constraint_id, revision, statement, authority_reference,
               state, created_at, created_by, supersedes
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (id) DO NOTHING;`,
            [
              p.id,
              p.policyConstraintId,
              p.revision,
              p.statement,
              p.authorityReference,
              p.state,
              p.createdAt,
              p.createdBy,
              p.supersedes ?? null
            ]
          );
        }
      }
    }
    const polIndexFiles = await this.listJsonFiles('policy-constraint-index');
    counts.policyConstraints = polIndexFiles.length;

    // 7. Engineering Decisions
    const decisionFiles = await this.listJsonFiles('engineering-decisions');
    for (const file of decisionFiles) {
      const d = await this.readJsonFile<EngineeringDecision>(file);
      if (d?.id) {
        counts.engineeringDecisions++;
        if (!this.dryRun) {
          await this.targetDb.query(
            `INSERT INTO engineering_decisions (
               id, baseline_id, statement, rationale, requirement_revision_ids,
               policy_constraint_revision_ids, state, created_at, created_by,
               accepted_by, accepted_at, supersedes, transition_rationale, version
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1)
             ON CONFLICT (id) DO NOTHING;`,
            [
              d.id,
              d.baselineId,
              d.statement,
              d.rationale,
              JSON.stringify(d.requirementRevisionIds ?? []),
              JSON.stringify(d.policyConstraintRevisionIds ?? []),
              d.state,
              d.createdAt,
              d.createdBy,
              d.acceptedBy ?? null,
              d.acceptedAt ?? null,
              d.supersedes ?? null,
              d.transitionRationale ?? null
            ]
          );
        }
      }
    }

    // 8. Projections
    const projectionFiles = await this.listJsonFiles('projections');
    for (const file of projectionFiles) {
      const proj = await this.readJsonFile<ProjectionRecord>(file);
      if (proj?.id) {
        counts.projections++;
        if (!this.dryRun) {
          const blobKey = `projections/${proj.id}.artifact`;
          await this.targetObjectStore.putObject(blobKey, proj.content ?? '', {
            contentType: 'text/plain'
          });
          await this.targetDb.query(
            `INSERT INTO projections (
               id, baseline_id, requirement_revision_ids, policy_constraint_revision_ids,
               engineering_decision_ids, artifact_type, content, payload_ref, metadata,
               created_at, version
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1)
             ON CONFLICT (id) DO NOTHING;`,
            [
              proj.id,
              proj.baselineId,
              JSON.stringify(proj.requirementRevisionIds ?? []),
              proj.policyConstraintRevisionIds
                ? JSON.stringify(proj.policyConstraintRevisionIds)
                : null,
              proj.engineeringDecisionIds ? JSON.stringify(proj.engineeringDecisionIds) : null,
              proj.artifactType,
              proj.content,
              blobKey,
              JSON.stringify(proj.metadata ?? {}),
              proj.createdAt
            ]
          );
        }
      }
    }

    // 9. Stories
    const storyFiles = await this.listJsonFiles('stories');
    for (const file of storyFiles) {
      const s = await this.readJsonFile<StoryRecord>(file);
      if (s?.id) {
        counts.stories++;
        if (!this.dryRun) {
          await this.targetDb.query(
            `INSERT INTO stories (
               id, baseline_id, projection_id, title, narrative, requirement_revision_ids,
               policy_constraint_revision_ids, scenarios, acceptance_criteria, gherkin_text,
               metadata, created_at, dependencies, version
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1)
             ON CONFLICT (id) DO NOTHING;`,
            [
              s.id,
              s.baselineId,
              s.projectionId,
              s.title,
              JSON.stringify(s.narrative ?? {}),
              JSON.stringify(s.requirementRevisionIds ?? []),
              s.policyConstraintRevisionIds ? JSON.stringify(s.policyConstraintRevisionIds) : null,
              JSON.stringify(s.scenarios ?? []),
              JSON.stringify(s.acceptanceCriteria ?? []),
              s.gherkinText ?? '',
              JSON.stringify(s.metadata ?? {}),
              s.createdAt,
              s.dependencies ? JSON.stringify(s.dependencies) : null
            ]
          );
        }
      }
    }

    // 10. Evaluation Runs
    const evalFiles = await this.listJsonFiles('evaluation-runs');
    for (const file of evalFiles) {
      const er = await this.readJsonFile<EvaluationRunRecord>(file);
      if (er?.id) {
        counts.evaluationRuns++;
        if (!this.dryRun) {
          const blobKey = `evaluation-runs/${er.id}/report.json`;
          await this.targetObjectStore.putObject(blobKey, JSON.stringify(er), {
            contentType: 'application/json'
          });
          await this.targetDb.query(
            `INSERT INTO evaluation_runs (
               id, corpus_version, executed_at, fixture_results, report, payload_ref
             ) VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO NOTHING;`,
            [
              er.id,
              er.corpusVersion,
              er.executedAt,
              JSON.stringify(er.fixtureResults ?? []),
              JSON.stringify(er.report ?? {}),
              blobKey
            ]
          );
        }
      }
    }

    // Baseline Verification
    const baselineVerification: {
      baselineId: string;
      requirementRevisionCount: number;
      verified: boolean;
    }[] = [];

    if (!this.dryRun) {
      const baselines = await this.targetRepo.listRequirementsBaselines();
      for (const b of baselines) {
        let verified = true;
        for (const revId of b.requirementRevisions) {
          const rev = await this.targetRepo.getRequirementRevision(
            createRequirementRevisionId(revId)
          );
          if (!rev) {
            verified = false;
            break;
          }
        }
        baselineVerification.push({
          baselineId: b.id,
          requirementRevisionCount: b.requirementRevisions.length,
          verified
        });
      }
    }

    const sha256Attestation = crypto
      .createHash('sha256')
      .update(JSON.stringify({ counts, baselineVerification, sourceDir: this.sourceDir }))
      .digest('hex');

    return {
      timestamp: new Date().toISOString(),
      sourceDir: this.sourceDir,
      dryRun: this.dryRun,
      recordCounts: counts,
      verified: baselineVerification.every((bv) => bv.verified),
      baselineVerification,
      sha256Attestation
    };
  }
}
