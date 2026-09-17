import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveLocatorIndex,
  slugifyHeading,
  extractSectionLabel,
  computeContentHash
} from '../../src/infrastructure/persistence/markdown/deriveLocatorIndex.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('deriveLocatorIndex', () => {
  it('slugifies headings properly, stripping numeric prefixes and converting & to and', () => {
    expect(slugifyHeading('3. Permanent Data Purge')).toBe('permanent-data-purge');
    expect(slugifyHeading('1. System Topology & Assumptions')).toBe(
      'system-topology-and-assumptions'
    );
    expect(slugifyHeading('11. Support Service Level Agreements')).toBe(
      'support-service-level-agreements'
    );
    expect(slugifyHeading('## 2.3 Permitted Transitions')).toBe('permitted-transitions');
    expect(slugifyHeading('Simple Heading')).toBe('simple-heading');
  });

  it('extracts explicit Section X.Y: labels correctly', () => {
    expect(
      extractSectionLabel("Section 3.1: When the 'Purge Organization Data' action is triggered...")
    ).toBe('3.1');
    expect(
      extractSectionLabel('Section 11.2: For Severity-1 outages, vendor response is required...')
    ).toBe('11.2');
    expect(extractSectionLabel('Section 7.3: Safety alert dispatch')).toBe('7.3');
    expect(extractSectionLabel('This line has no section prefix.')).toBeUndefined();
    expect(extractSectionLabel('# 1. Heading')).toBeUndefined();
  });

  it('computes deterministic sha256 content hashes', () => {
    const text1 = 'Hello World\n';
    const text2 = 'Hello World\n';
    const text3 = 'Different text';
    expect(computeContentHash(text1)).toBe(computeContentHash(text2));
    expect(computeContentHash(text1)).not.toBe(computeContentHash(text3));
    expect(computeContentHash(text1)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles a simple single-heading document with sequential unlabeled blocks', () => {
    const md = `# Overview

This is the first paragraph.

This is the second paragraph.`;

    const index = deriveLocatorIndex(md);
    expect(index).toHaveLength(2);
    expect(index[0]).toMatchObject({
      locator: 'overview#1',
      headingPath: 'overview',
      blockLabel: '1',
      blockLabelSource: 'sequential-ordinal',
      text: 'This is the first paragraph.',
      startLine: 3,
      endLine: 3
    });
    expect(index[1]).toMatchObject({
      locator: 'overview#2',
      headingPath: 'overview',
      blockLabel: '2',
      blockLabelSource: 'sequential-ordinal',
      text: 'This is the second paragraph.',
      startLine: 5,
      endLine: 5
    });
  });

  it('resets sequential ordinals per heading', () => {
    const md = `# Section One

Paragraph 1A.

Paragraph 1B.

# Section Two

Paragraph 2A.`;

    const index = deriveLocatorIndex(md);
    expect(index).toHaveLength(3);
    expect(index[0].locator).toBe('section-one#1');
    expect(index[1].locator).toBe('section-one#2');
    expect(index[2].locator).toBe('section-two#1');
  });

  it('joins nested heading paths with forward slash', () => {
    const md = `# System

Top level intro.

## Architecture

Component details.

### Storage

Blob store requirements.`;

    const index = deriveLocatorIndex(md);
    expect(index).toHaveLength(3);
    expect(index[0].locator).toBe('system#1');
    expect(index[0].headingPath).toBe('system');
    expect(index[1].locator).toBe('system/architecture#1');
    expect(index[1].headingPath).toBe('system/architecture');
    expect(index[2].locator).toBe('system/architecture/storage#1');
    expect(index[2].headingPath).toBe('system/architecture/storage');
  });

  it('strips numeric heading prefixes and extracts explicit Section labels (Finding 1 fix)', () => {
    const md = `# 3. Permanent Data Purge

Section 3.1: When the 'Purge Organization Data' action is triggered from the management console, the system permanently removes all databases, backups, and user credentials for the target organization within 5 minutes.`;

    const index = deriveLocatorIndex(md);
    expect(index).toHaveLength(1);
    expect(index[0]).toMatchObject({
      locator: 'permanent-data-purge#3.1',
      headingPath: 'permanent-data-purge',
      blockLabel: '3.1',
      blockLabelSource: 'explicit-section',
      startLine: 3,
      endLine: 3
    });
    expect(index[0].text).toContain('permanently removes all databases');
  });

  it('addresses content before first heading under preamble', () => {
    const md = `---
title: Test Document
---

Initial introductory text.

# Main

Main content.`;

    const index = deriveLocatorIndex(md);
    expect(index).toHaveLength(3);
    expect(index[0].locator).toBe('preamble#1');
    expect(index[0].headingPath).toBe('preamble');
    expect(index[1].locator).toBe('preamble#2');
    expect(index[1].headingPath).toBe('preamble');
    expect(index[2].locator).toBe('main#1');
    expect(index[2].headingPath).toBe('main');
  });

  it('treats fenced code blocks with internal blank lines as a single block', () => {
    const md = `# Scripting

\`\`\`bash
echo "step 1"

echo "step 2"
\`\`\`

After code block.`;

    const index = deriveLocatorIndex(md);
    expect(index).toHaveLength(2);
    expect(index[0].locator).toBe('scripting#1');
    expect(index[0].text).toBe('```bash\necho "step 1"\n\necho "step 2"\n```');
    expect(index[0].startLine).toBe(3);
    expect(index[0].endLine).toBe(7);
    expect(index[1].locator).toBe('scripting#2');
    expect(index[1].text).toBe('After code block.');
  });

  it('deterministically suffixes duplicate heading paths with -2, -3', () => {
    const md = `# Common

Block A.

# Common

Block B.

# Common

Block C.`;

    const index = deriveLocatorIndex(md);
    expect(index).toHaveLength(3);
    expect(index[0].locator).toBe('common#1');
    expect(index[0].headingPath).toBe('common');
    expect(index[1].locator).toBe('common-2#1');
    expect(index[1].headingPath).toBe('common-2');
    expect(index[2].locator).toBe('common-3#1');
    expect(index[2].headingPath).toBe('common-3');
  });

  it('deterministically suffixes duplicate final locators with -dup2, -dup3', () => {
    const md = `# Rules

Section 1.1: First occurrence.

Section 1.1: Duplicate label occurrence.

Section 1.1: Triplicate label occurrence.`;

    const index = deriveLocatorIndex(md);
    expect(index).toHaveLength(3);
    expect(index[0].locator).toBe('rules#1.1');
    expect(index[1].locator).toBe('rules#1.1-dup2');
    expect(index[2].locator).toBe('rules#1.1-dup3');
  });

  it('is purely deterministic on identical markdown input', () => {
    const md = `# 1. Test Heading

Section 1.1: Some content here.

Additional content block.`;

    const run1 = deriveLocatorIndex(md);
    const run2 = deriveLocatorIndex(md);
    expect(run1).toEqual(run2);
  });

  it('full fixture corpus regression: all 16 evaluation fixtures match 100% of expected locators', () => {
    const fixturesDir = path.resolve(__dirname, '../evaluation/fixtures');
    const fixtureEntries = fs.readdirSync(fixturesDir, { withFileTypes: true });

    let testedLocatorsCount = 0;

    for (const entry of fixtureEntries) {
      if (!entry.isDirectory()) continue;
      const expectedJsonPath = path.join(fixturesDir, entry.name, 'expected.json');
      if (!fs.existsSync(expectedJsonPath)) continue;

      const expectedJson = JSON.parse(fs.readFileSync(expectedJsonPath, 'utf-8'));
      const sources: Array<{ sourceRevisionId: string; path: string }> = expectedJson.sources ?? [];

      const expectedLocatorsBySource = new Map<string, Set<string>>();
      for (const req of expectedJson.expectedRequirements ?? []) {
        for (const ev of req.evidence ?? []) {
          if (!expectedLocatorsBySource.has(ev.sourceRevisionId)) {
            expectedLocatorsBySource.set(ev.sourceRevisionId, new Set());
          }
          expectedLocatorsBySource.get(ev.sourceRevisionId)!.add(ev.locator);
        }
      }
      for (const f of expectedJson.expectedFindings ?? []) {
        for (const ev of f.evidence ?? []) {
          if (!expectedLocatorsBySource.has(ev.sourceRevisionId)) {
            expectedLocatorsBySource.set(ev.sourceRevisionId, new Set());
          }
          expectedLocatorsBySource.get(ev.sourceRevisionId)!.add(ev.locator);
        }
      }

      for (const src of sources) {
        const sourcePath = path.join(fixturesDir, entry.name, src.path);
        expect(fs.existsSync(sourcePath), `Source file ${sourcePath} must exist`).toBe(true);

        const markdownText = fs.readFileSync(sourcePath, 'utf-8');
        const derivedIndex = deriveLocatorIndex(markdownText);
        const derivedLocatorSet = new Set(derivedIndex.map((e) => e.locator));

        // Check requirements
        for (const req of expectedJson.expectedRequirements ?? []) {
          for (const ev of req.evidence ?? []) {
            if (ev.sourceRevisionId === src.sourceRevisionId) {
              testedLocatorsCount++;
              expect(
                derivedLocatorSet.has(ev.locator),
                `Fixture '${entry.name}' source '${src.path}' (${src.sourceRevisionId}) must contain requirement evidence locator '${ev.locator}'`
              ).toBe(true);
            }
          }
        }

        // Check findings
        for (const f of expectedJson.expectedFindings ?? []) {
          for (const ev of f.evidence ?? []) {
            if (ev.sourceRevisionId === src.sourceRevisionId) {
              testedLocatorsCount++;
              expect(
                derivedLocatorSet.has(ev.locator),
                `Fixture '${entry.name}' source '${src.path}' (${src.sourceRevisionId}) must contain finding evidence locator '${ev.locator}'`
              ).toBe(true);
            }
          }
        }
      }
    }

    expect(testedLocatorsCount).toBeGreaterThanOrEqual(60);
  });

  it('canonical-messy-discovery-package locator regression: all four sources derive expected locators', () => {
    const messyDir = path.resolve(
      __dirname,
      '../evaluation/fixtures/canonical-messy-discovery-package'
    );
    const expectedJson = JSON.parse(fs.readFileSync(path.join(messyDir, 'expected.json'), 'utf-8'));

    // Multi-digit ordinals check
    const source2Md = fs.readFileSync(path.join(messyDir, 'source.2.md'), 'utf-8');
    const source2Index = deriveLocatorIndex(source2Md);
    const source2Locators = new Set<string>(source2Index.map((e) => e.locator));

    expect(source2Locators.has('support-service-level-agreements#11.1')).toBe(true);
    expect(source2Locators.has('support-service-level-agreements#11.2')).toBe(true);
    expect(source2Locators.has('archival-maintenance#8.1')).toBe(true);
    expect(source2Locators.has('safety-alert-dispatches#7.3')).toBe(true);
    expect(source2Locators.has('batch-telemetry-processing#6.2')).toBe(true);
    expect(source2Locators.has('emergency-intervention-controls#4.1')).toBe(true);
    expect(source2Locators.has('contractor-access-governance#3.1')).toBe(true);
    expect(source2Locators.has('executive-purchase-sign-off#2.1')).toBe(true);

    // Verify all four sources derive their respective expected locators
    for (const src of expectedJson.sources as Array<{ sourceRevisionId: string; path: string }>) {
      const srcMd = fs.readFileSync(path.join(messyDir, src.path), 'utf-8');
      const idx = deriveLocatorIndex(srcMd);
      const locSet = new Set<string>(idx.map((e) => e.locator));

      for (const req of expectedJson.expectedRequirements ?? []) {
        for (const ev of req.evidence ?? []) {
          if (ev.sourceRevisionId === src.sourceRevisionId) {
            expect(locSet.has(ev.locator)).toBe(true);
          }
        }
      }
      for (const f of expectedJson.expectedFindings ?? []) {
        for (const ev of f.evidence ?? []) {
          if (ev.sourceRevisionId === src.sourceRevisionId) {
            expect(locSet.has(ev.locator)).toBe(true);
          }
        }
      }
    }
  });
});
