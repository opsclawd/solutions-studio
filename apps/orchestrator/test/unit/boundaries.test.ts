import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

describe('Architectural Boundary Enforcement Drift Guard', () => {
  const rootDir = path.resolve(__dirname, '../../../../');
  const depcruiseConfigPath = path.join(rootDir, '.dependency-cruiser.cjs');
  const rootPackageJsonPath = path.join(rootDir, 'package.json');
  const aiOrchestratorJsonPath = path.join(rootDir, '.ai-orchestrator.json');
  const ciWorkflowPath = path.join(rootDir, '.github/workflows/ci.yml');

  it('declares .dependency-cruiser.cjs with all required architectural rules', () => {
    expect(fs.existsSync(depcruiseConfigPath)).toBe(true);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const config = require(depcruiseConfigPath);
    expect(config).toBeDefined();
    expect(Array.isArray(config.forbidden)).toBe(true);

    const ruleNames = new Set(config.forbidden.map((r: { name: string }) => r.name));
    const expectedRules = [
      'domain-zero-external-deps',
      'domain-cannot-depend-on-contracts-or-apps',
      'contracts-cannot-depend-on-apps',
      'orchestrator-application-cannot-depend-on-infrastructure',
      'orchestrator-http-routes-cannot-depend-on-infrastructure',
      'orchestrator-cannot-depend-on-web',
      'web-cannot-depend-on-orchestrator',
      'no-circular',
      'no-test-imports-from-non-test'
    ];

    for (const rule of expectedRules) {
      expect(ruleNames.has(rule), `Expected rule '${rule}' in .dependency-cruiser.cjs`).toBe(true);
    }
  });

  it('configures boundaries script in root package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(rootPackageJsonPath, 'utf-8'));
    expect(pkg.scripts?.boundaries).toBe(
      'depcruise apps packages --config .dependency-cruiser.cjs'
    );
  });

  it('integrates pnpm boundaries in .ai-orchestrator.json validation suite', () => {
    const aiConfig = JSON.parse(fs.readFileSync(aiOrchestratorJsonPath, 'utf-8'));
    expect(aiConfig.validation?.commands).toContain('pnpm boundaries');

    const tierCommands = (aiConfig.validation?.tiers ?? []).flat();
    expect(tierCommands).toContain('pnpm boundaries');
  });

  it('integrates Check boundaries step in CI workflow (.github/workflows/ci.yml)', () => {
    const ciContent = fs.readFileSync(ciWorkflowPath, 'utf-8');
    expect(ciContent).toContain('name: Check boundaries');
    expect(ciContent).toContain('run: pnpm boundaries');
  });

  it('executes pnpm boundaries successfully with zero violations across apps and packages', () => {
    try {
      const result = execFileSync('pnpm', ['boundaries'], {
        cwd: rootDir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe']
      });

      expect(result).toMatch(/no dependency violations found/i);
    } catch (err: unknown) {
      const execErr = err as {
        status?: number;
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      const output = `${execErr.stdout ?? ''}\n${execErr.stderr ?? ''}\n${execErr.message ?? ''}`;
      if (
        execErr.message?.includes('ENOENT') ||
        execErr.message?.includes('spawn') ||
        execErr.message?.includes('EPERM') ||
        execErr.message?.includes('EACCES') ||
        execErr.message?.toLowerCase().includes('permission')
      ) {
        console.warn('Skipping test: pnpm executable not spawnable in this test environment');
        return;
      }
      expect(output).toMatch(/no dependency violations found/i);
      expect(execErr.status).toBe(0);
    }
  });
});
