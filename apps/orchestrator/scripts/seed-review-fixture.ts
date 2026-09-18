#!/usr/bin/env tsx
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  createSourceId,
  createRequirementId,
  createRequirementRevisionId,
  createFindingId,
  createRequirementsBaselineId,
  createReviewerId,
  createRequirementRevision,
  createCandidateFinding,
  type RequirementsBaseline,
  now
} from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import type { ProjectionRecord } from '../src/application/ports/persistence/IRequirementsRepository.js';

export function parseArgs(args: string[]): { outDir: string } {
  let outDir = '.review-fixture-store';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--out') {
      outDir = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: tsx scripts/seed-review-fixture.ts [--out <dir>]');
      process.exit(0);
    } else {
      throw new Error(`Unknown option: '${arg}'`);
    }
  }
  return { outDir: path.resolve(process.cwd(), outDir) };
}

export async function seedReviewFixture(targetDir: string) {
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(targetDir, { recursive: true });
  const repo = new FilesystemRequirementsRepository({ baseDir: targetDir });

  // 1. Capture source markdown for evidence references
  const src = await repo.captureSourceRevision({
    sourceId: createSourceId('SRC-001'),
    sourceType: 'sop',
    markdownText:
      '# Enterprise Security Standard\n\n' +
      '## Encryption at Rest\n\n' +
      'All relational and object databases storing customer data must employ AES-256 encryption at rest.\n\n' +
      '## Role-Based Access Control\n\n' +
      'Administrative roles must require multi-factor authentication and role-based privilege assignment.\n\n' +
      '## Session Management\n\n' +
      'User sessions must expire after 15 minutes of inactivity across all internal web portals.'
  });

  const locators = src.locatorIndex;
  const encryptionLocator = locators[0]?.locator ?? 'sec-1';
  const rbacLocator = locators[1]?.locator ?? 'sec-2';
  const sessionLocator = locators[2]?.locator ?? 'sec-3';

  // 2. Requirement 1: PENDING / EXPLICIT (1 revision, no findings attached)
  const req1Rev1 = createRequirementRevision({
    id: createRequirementRevisionId('REQ-001-R1'),
    requirementId: createRequirementId('REQ-001'),
    revision: 1,
    statement:
      'All relational and object databases storing customer data must employ AES-256 encryption at rest.',
    category: 'business-rule',
    origin: 'EXPLICIT',
    reviewState: 'PENDING',
    resolutionState: 'UNRESOLVED',
    evidence: [
      {
        sourceRevisionId: src.revision.id,
        locator: encryptionLocator
      }
    ]
  });
  await repo.saveRequirementRevision(req1Rev1);

  // 3. Requirement 2: ACCEPTED (already past PENDING)
  const req2Rev1 = createRequirementRevision({
    id: createRequirementRevisionId('REQ-002-R1'),
    requirementId: createRequirementId('REQ-002'),
    revision: 1,
    statement:
      'Administrative roles must require multi-factor authentication and role-based privilege assignment.',
    category: 'actors-permissions',
    origin: 'EXPLICIT',
    reviewState: 'ACCEPTED',
    resolutionState: 'CLEAR',
    evidence: [
      {
        sourceRevisionId: src.revision.id,
        locator: rbacLocator
      }
    ]
  });
  await repo.saveRequirementRevision(req2Rev1);
  await repo.appendReconciliationRecord({
    id: 'REC-REQ-002-R1',
    entityType: 'requirement',
    entityId: createRequirementId('REQ-002'),
    requirementRevisionId: req2Rev1.id,
    action: 'ACCEPT',
    previousReviewState: undefined,
    newReviewState: 'ACCEPTED',
    previousResolutionState: undefined,
    newResolutionState: undefined,
    rationale: 'Verified against enterprise security baseline.',
    recordedAt: now()
  });

  // 4. Requirement 3: CONFLICTED / UNRESOLVED whose first revision (R1) has an open finding attached
  const req3Rev1 = createRequirementRevision({
    id: createRequirementRevisionId('REQ-003-R1'),
    requirementId: createRequirementId('REQ-003'),
    revision: 1,
    statement:
      'User sessions must expire after 15 minutes of inactivity across all internal web portals.',
    category: 'business-rule',
    origin: 'GENERATED_PROPOSAL',
    reviewState: 'PENDING',
    resolutionState: 'CONFLICTED',
    evidence: [
      {
        sourceRevisionId: src.revision.id,
        locator: sessionLocator
      }
    ]
  });
  await repo.saveRequirementRevision(req3Rev1);

  // Open finding attached to REQ-003-R1
  const finding1 = createCandidateFinding({
    id: createFindingId('FIND-001'),
    type: 'contradiction',
    affectedRequirementRevisions: [req3Rev1.id],
    evidence: [
      {
        sourceRevisionId: src.revision.id,
        locator: sessionLocator
      }
    ],
    discoveredBy: 'model',
    disposition: 'OPEN',
    rationale: 'Conflict detected: Maintenance portal requires 60-minute session duration.'
  });
  await repo.saveCandidateFinding(finding1);

  // 5. Unattached open finding (empty affectedRequirementRevisions: [])
  const finding2 = createCandidateFinding({
    id: createFindingId('FIND-UNATTACHED-001'),
    type: 'missing-authorization',
    affectedRequirementRevisions: [],
    evidence: [],
    discoveredBy: 'model',
    disposition: 'OPEN',
    rationale:
      'Repository-wide security discovery: Emergency break-glass access procedure is unspecified.'
  });
  await repo.saveCandidateFinding(finding2);

  // 6. Verified baseline BASE-001 containing REQ-002-R1
  const baseline1: RequirementsBaseline = {
    id: createRequirementsBaselineId('BASE-001'),
    requirementRevisions: [req2Rev1.id],
    createdBy: createReviewerId('lead-reviewer'),
    createdAt: now()
  };
  await repo.saveRequirementsBaseline(baseline1);

  // 7. Initial projection PROJ-001 bound to BASE-001
  const proj1Content =
    'graph TD\n' +
    '  Start([Start Request]) --> Auth{Verify Admin MFA}\n' +
    '  Auth -->|Authorized| Grant[Assign RBAC Role]\n' +
    '  Auth -->|Denied| Reject[Deny Access]';

  const proj1: ProjectionRecord = {
    id: 'PROJ-001',
    baselineId: baseline1.id,
    requirementRevisionIds: [req2Rev1.id],
    artifactType: 'process-diagram',
    content: proj1Content,
    metadata: {
      baselineId: 'BASE-001',
      requirementRevisionIds: ['REQ-002-R1'],
      artifactType: 'process-diagram',
      declaredProvenance: {
        baselineId: 'BASE-001',
        requirementRevisionIds: ['REQ-002-R1']
      },
      configuredExecution: {
        provider: 'fake',
        artifactType: 'process-diagram'
      },
      measuredVerification: {
        repairsNeeded: 0,
        attemptCount: 1,
        contentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        verifiedAt: now()
      }
    },
    createdAt: now()
  };
  await repo.saveProjectionRecord(proj1);

  // 8. Initial prototype projection PROJ-002 bound to BASE-001
  const proj2Content = [
    '/**',
    ' * @baseline BASE-001',
    ' * @requirements REQ-002-R1',
    ' */',
    "import React, { useState } from 'react';",
    '',
    'export default function CounterPrototype() {',
    '  const [count, setCount] = useState(0);',
    '  return (',
    '    <div className="p-6 bg-white rounded-lg border border-gray-200">',
    '      <h2 className="text-sm font-bold text-gray-900 mb-2">Interactive Counter Prototype</h2>',
    '      <p data-testid="counter-value" className="text-xs text-gray-700 font-mono mb-4">',
    '        Count: {count}',
    '      </p>',
    '      <button',
    '        type="button"',
    '        data-testid="increment-btn"',
    '        onClick={() => setCount((c) => c + 1)}',
    '        className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold"',
    '      >',
    '        Increment Counter',
    '      </button>',
    '    </div>',
    '  );',
    '}'
  ].join('\n');

  const proj2: ProjectionRecord = {
    id: 'PROJ-002',
    baselineId: baseline1.id,
    requirementRevisionIds: [req2Rev1.id],
    artifactType: 'prototype',
    content: proj2Content,
    metadata: {
      baselineId: 'BASE-001',
      requirementRevisionIds: ['REQ-002-R1'],
      artifactType: 'prototype',
      declaredProvenance: {
        baselineId: 'BASE-001',
        requirementRevisionIds: ['REQ-002-R1']
      },
      configuredExecution: {
        provider: 'fake',
        artifactType: 'prototype'
      },
      measuredVerification: {
        repairsNeeded: 0,
        attemptCount: 1,
        contentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        verifiedAt: now()
      }
    },
    createdAt: now()
  };
  await repo.saveProjectionRecord(proj2);

  console.log(`Seeded review fixture store at: ${targetDir}`);
}

export async function main() {
  const { outDir } = parseArgs(process.argv.slice(2));
  await seedReviewFixture(outDir);
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  (import.meta.url === `file://${path.resolve(process.argv[1])}` ||
    process.argv[1].endsWith('seed-review-fixture.ts') ||
    process.argv[1].endsWith('seed-review-fixture.js'));

if (isDirectRun) {
  main().catch((err) => {
    console.error('Fatal error seeding review fixture:', err);
    process.exit(1);
  });
}
