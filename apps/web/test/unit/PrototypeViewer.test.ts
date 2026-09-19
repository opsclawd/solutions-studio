import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PrototypeViewer } from '../../src/features/review/components/PrototypeViewer';
import type { ProjectionRecordDto } from '@solutions-studio/contracts';
import { createInstant } from '@solutions-studio/domain';

describe('PrototypeViewer', () => {
  const sampleProjection: ProjectionRecordDto = {
    id: 'PROJ-PROTO-101',
    baselineId: 'BASE-101',
    requirementRevisionIds: ['REQ-101-R1'],
    artifactType: 'prototype',
    content: 'export default function App() { return <div>App</div>; }',
    metadata: {
      baselineId: 'BASE-101',
      requirementRevisionIds: ['REQ-101-R1'],
      artifactType: 'prototype',
      declaredProvenance: {
        baselineId: 'BASE-101',
        requirementRevisionIds: ['REQ-101-R1']
      },
      configuredExecution: {
        provider: 'fake',
        artifactType: 'prototype'
      },
      measuredVerification: {
        repairsNeeded: 0,
        attemptCount: 1,
        contentHash: 'hash-101-abcdef',
        verifiedAt: createInstant('2026-09-18T12:00:00.000Z')
      }
    },
    createdAt: createInstant('2026-09-18T12:00:00.000Z')
  };

  it('renders provenance bar with baseline ID, revisions, and verification metrics', () => {
    const html = renderToStaticMarkup(
      React.createElement(PrototypeViewer, { projection: sampleProjection })
    );

    expect(html).toContain('data-testid="prototype-viewer"');
    expect(html).toContain('data-testid="projection-provenance-bar"');
    expect(html).toContain('data-testid="projection-baseline-id"');
    expect(html).toContain('BASE-101');
    expect(html).toContain('data-testid="projection-rev-chip-REQ-101-R1"');
    expect(html).toContain('REQ-101-R1');
    expect(html).toContain('data-testid="projection-repairs-needed"');
    expect(html).toContain('data-testid="projection-attempt-count"');
    expect(html).toContain('data-testid="projection-content-hash"');
    expect(html).toContain('data-testid="prototype-sandbox-container"');
    expect(html).toContain('data-testid="toggle-raw-code-btn"');
    expect(html).toContain('data-testid="export-prototype-btn"');
  });
});
