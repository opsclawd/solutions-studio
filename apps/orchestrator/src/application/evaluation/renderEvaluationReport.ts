import type { EvaluationReportDto, ScoreCountersDto } from '@solutions-studio/contracts';
import { FIXTURE_CATEGORIES } from '@solutions-studio/contracts';
import { REQUIREMENT_CATEGORIES } from '@solutions-studio/domain';

function formatPercent(val: number | null): string {
  if (val === null) return 'N/A';
  return `${(val * 100).toFixed(1)}%`;
}

function formatCountersRow(name: string, counters?: ScoreCountersDto): string {
  const c = counters ?? {
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 0,
    precision: null,
    recall: null,
    f1Score: null
  };
  return `| \`${name}\` | ${c.truePositives} | ${c.falsePositives} | ${c.falseNegatives} | ${formatPercent(c.precision)} | ${formatPercent(c.recall)} | ${formatPercent(c.f1Score)} |`;
}

export function renderJsonReport(report: EvaluationReportDto): string {
  return JSON.stringify(report, null, 2) + '\n';
}

export function renderHumanReport(report: EvaluationReportDto): string {
  const lines: string[] = [];

  lines.push('# Requirements Intelligence Compiler Evaluation Report');
  lines.push('');
  lines.push('## Run Identity & Provenance');
  lines.push('');
  lines.push(`- **Run ID:** \`${report.runId}\``);
  lines.push(`- **Executed At:** \`${report.executedAt}\``);
  lines.push(`- **Corpus Version:** \`${report.corpusVersion}\``);
  lines.push(`- **Corpus Identity Digest:** \`${report.corpusIdentity}\``);
  if (report.candidateSha.status === 'available') {
    lines.push(`- **Candidate Git SHA:** \`${report.candidateSha.value}\``);
  } else {
    lines.push(`- **Candidate Git SHA:** *Unavailable* (${report.candidateSha.reason})`);
  }
  lines.push(`- **Provider Mode:** \`${report.provenance.requested.providerMode}\``);
  lines.push(`- **Compiler Version:** \`${report.provenance.configured.compilerVersion}\``);
  lines.push(`- **Prompt Version:** \`${report.provenance.configured.promptVersion}\``);
  lines.push(
    `- **Runtime:** Node ${report.provenance.configured.nodeVersion} (${report.provenance.configured.platform} ${report.provenance.configured.arch})`
  );
  lines.push('');

  lines.push('## Execution Summary');
  lines.push('');
  lines.push(`- **Total Manifest Fixtures:** ${report.aggregateScores.totalFixtures}`);
  lines.push(`- **Completed Fixtures:** ${report.aggregateScores.completedFixtures}`);
  lines.push(`- **Failed Fixtures:** ${report.aggregateScores.failedFixtures}`);

  if (report.aggregateScores.totalDurationMs) {
    lines.push(
      `- **Total Elapsed Duration:** ${report.aggregateScores.totalDurationMs.value}ms (${report.aggregateScores.totalDurationMs.contributingCompletedFixtureCount} contributing fixtures, ${report.aggregateScores.totalDurationMs.unavailableFixtureCount} unavailable)`
    );
  }
  if (report.aggregateScores.totalTokens) {
    lines.push(
      `- **Total Token Usage:** ${report.aggregateScores.totalTokens.value} tokens (${report.aggregateScores.totalTokens.contributingCompletedFixtureCount} contributing fixtures, ${report.aggregateScores.totalTokens.unavailableFixtureCount} unavailable)`
    );
  }
  lines.push('');

  lines.push('### Measured Provider & Model Execution Metadata');
  lines.push('');
  lines.push('| Fixture | Status | Provider | Model | Duration | Tokens |');
  lines.push('| :--- | :---: | :---: | :---: | :---: | :---: |');
  for (const f of report.fixtureResults) {
    if (f.status === 'completed') {
      const pm = f.executed.providerMetadata;
      if (pm.status === 'available') {
        const prov = pm.value.provider ?? 'N/A';
        const mod = pm.value.model ?? 'N/A';
        const dur = pm.value.durationMs !== undefined ? `${pm.value.durationMs}ms` : 'N/A';
        const tok = pm.value.tokens?.total !== undefined ? `${pm.value.tokens.total}` : 'N/A';
        lines.push(
          `| \`${f.fixtureId}\` | \`completed\` | \`${prov}\` | \`${mod}\` | ${dur} | ${tok} |`
        );
      } else {
        lines.push(
          `| \`${f.fixtureId}\` | \`completed\` | *Unavailable* (${pm.reason}) | *Unavailable* | N/A | N/A |`
        );
      }
    } else {
      lines.push(`| \`${f.fixtureId}\` | \`failed\` | N/A | N/A | N/A | N/A |`);
    }
  }
  lines.push('');

  // Finding Quality by Category Table
  lines.push('## Defect Finding Quality by Category');
  lines.push('');
  lines.push('| Defect Category | TP | FP | FN | Precision | Recall | F1 Score |');
  lines.push('| :--- | :---: | :---: | :---: | :---: | :---: | :---: |');
  for (const cat of FIXTURE_CATEGORIES) {
    const counters = report.aggregateScores.findingsByCategory[cat];
    lines.push(formatCountersRow(cat, counters));
  }
  lines.push('');
  if (report.aggregateScores.unclassifiedFindingsCount > 0) {
    lines.push(
      `> [!WARNING]\n> **Unclassified False Positive Findings:** ${report.aggregateScores.unclassifiedFindingsCount} candidate findings did not match any expected finding or non-finding signature.`
    );
    lines.push('');
  }

  // Requirement Quality by Category Table
  lines.push('## Requirement Extraction Quality by Category');
  lines.push('');
  lines.push('| Requirement Category | TP | FP | FN | Precision | Recall | F1 Score |');
  lines.push('| :--- | :---: | :---: | :---: | :---: | :---: | :---: |');
  for (const cat of REQUIREMENT_CATEGORIES) {
    const counters = report.aggregateScores.requirementsByCategory[cat];
    lines.push(formatCountersRow(cat, counters));
  }
  lines.push('');

  // Category-specific misses (FNs)
  const missingFindings: {
    fixtureId: string;
    findingKey?: string;
    category?: string;
    domainType: string;
  }[] = [];
  const missingReqs: { fixtureId: string; requirementKey?: string; category: string }[] = [];
  const nonFindingFPs: {
    fixtureId: string;
    category?: string;
    desc?: string;
    findingId?: string;
  }[] = [];
  const unclassifiedFPs: { fixtureId: string; findingId?: string; domainType: string }[] = [];

  for (const fixtureRes of report.fixtureResults) {
    if (fixtureRes.status === 'completed') {
      const score = fixtureRes.measured.score;
      for (const m of score.mismatchedFindings) {
        if (m.type === 'missing-expected') {
          missingFindings.push({
            fixtureId: fixtureRes.fixtureId,
            findingKey: m.findingKey,
            category: m.category,
            domainType: m.domainType
          });
        } else if (m.type === 'matched-expected-non-finding') {
          nonFindingFPs.push({
            fixtureId: fixtureRes.fixtureId,
            category: m.category,
            desc: m.matchedNonFindingDescription,
            findingId: m.findingId
          });
        }
      }

      for (const m of score.mismatchedRequirements) {
        if (m.type === 'missing-expected') {
          missingReqs.push({
            fixtureId: fixtureRes.fixtureId,
            requirementKey: m.requirementKey,
            category: m.category
          });
        }
      }

      for (const u of score.unclassifiedFindings) {
        unclassifiedFPs.push({
          fixtureId: fixtureRes.fixtureId,
          findingId: u.findingId,
          domainType: u.domainType
        });
      }
    }
  }

  lines.push('## Category-Specific Misses (False Negatives)');
  lines.push('');
  if (missingFindings.length === 0 && missingReqs.length === 0) {
    lines.push('No false negatives observed across evaluated fixtures.');
  } else {
    if (missingFindings.length > 0) {
      lines.push('### Missing Expected Defect Findings');
      lines.push('');
      for (const mf of missingFindings) {
        lines.push(
          `- Fixture \`${mf.fixtureId}\`: Expected finding \`${mf.findingKey}\` (${mf.category} / ${mf.domainType})`
        );
      }
      lines.push('');
    }
    if (missingReqs.length > 0) {
      lines.push('### Missing Expected Requirements');
      lines.push('');
      for (const mr of missingReqs) {
        lines.push(
          `- Fixture \`${mr.fixtureId}\`: Expected requirement \`${mr.requirementKey}\` (\`${mr.category}\`)`
        );
      }
      lines.push('');
    }
  }
  lines.push('');

  lines.push('## False-Positive Hotspots');
  lines.push('');
  if (nonFindingFPs.length === 0 && unclassifiedFPs.length === 0) {
    lines.push('No false positives observed across evaluated fixtures.');
  } else {
    if (nonFindingFPs.length > 0) {
      lines.push('### Expected Non-Finding Hotspots (Planted Traps Triggered)');
      lines.push('');
      for (const nfp of nonFindingFPs) {
        lines.push(
          `- Fixture \`${nfp.fixtureId}\`: Category \`${nfp.category}\` — ${nfp.desc ?? 'Planted near-conflict triggered'} (Finding: \`${nfp.findingId}\`)`
        );
      }
      lines.push('');
    }
    if (unclassifiedFPs.length > 0) {
      lines.push('### Unclassified Spurious Findings');
      lines.push('');
      for (const ufp of unclassifiedFPs) {
        lines.push(
          `- Fixture \`${ufp.fixtureId}\`: Spurious finding \`${ufp.findingId}\` (Type: \`${ufp.domainType}\`)`
        );
      }
      lines.push('');
    }
  }
  // Semantic Review Diagnostics
  const statementDiagnostics: {
    fixtureId: string;
    requirementKey: string;
    category: string;
    pattern: string;
    statement: string;
  }[] = [];

  for (const f of report.fixtureResults) {
    if (f.status === 'completed') {
      for (const req of f.measured.score.matchedRequirements) {
        if (req.statementPatternDiagnostic && !req.statementPatternDiagnostic.matched) {
          statementDiagnostics.push({
            fixtureId: f.fixtureId,
            requirementKey: req.expectedRequirementKey,
            category: req.category,
            pattern: req.statementPatternDiagnostic.pattern,
            statement: req.statement
          });
        }
      }
    }
  }

  lines.push('## Semantic Review Diagnostics (Statement Pattern Warnings)');
  lines.push('');
  if (statementDiagnostics.length === 0) {
    lines.push(
      'All structurally matched requirements satisfied expected statement patterns or had no pattern specified.'
    );
  } else {
    lines.push(
      '> [!NOTE]\n> Statement pattern mismatches are qualitative review diagnostics for structurally matched requirements; they do not alter structural TP/FP/FN scores.'
    );
    lines.push('');
    for (const d of statementDiagnostics) {
      lines.push(
        `- Fixture \`${d.fixtureId}\`: Requirement \`${d.requirementKey}\` (\`${d.category}\`) did not match pattern \`${d.pattern}\`:\n  - Statement: "${d.statement}"`
      );
    }
  }
  lines.push('');

  // Failures section
  const failedResults = report.fixtureResults.filter(
    (f): f is Extract<typeof f, { status: 'failed' }> => f.status === 'failed'
  );
  if (failedResults.length > 0) {
    lines.push('## Execution Failures');
    lines.push('');
    for (const failed of failedResults) {
      lines.push(
        `- **Fixture:** \`${failed.fixtureId}\` (Phase: \`${failed.error.phase}\`): ${failed.error.name}: ${failed.error.message}`
      );
    }
    lines.push('');
  }

  lines.push('## Empirical Baseline Notice');
  lines.push('');
  lines.push(
    '> [!NOTE]\n> This report reflects empirical versioned corpus evaluation. No arbitrary production promotion threshold (such as 90% or 95%) is enforced by this runner. Phase 1 candidate approval requires authoritative human review via `docs/phase-1-report-template.md`.'
  );
  lines.push('');

  return lines.join('\n');
}
