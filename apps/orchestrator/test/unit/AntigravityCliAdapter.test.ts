import { describe, it, expect } from 'vitest';
import { AntigravityCliAdapter } from '../../src/infrastructure/generation/AntigravityCliAdapter.js';
import {
  ExecutableNotFoundError,
  AuthenticationOrConfigError,
  NonZeroExitError,
  MalformedOutputError,
  CliExecutionTimeoutError
} from '../../src/application/ports/generation/GenerationErrors.js';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';

describe('AntigravityCliAdapter', () => {
  it('throws ExecutableNotFoundError when binary does not exist', async () => {
    const adapter = new AntigravityCliAdapter({
      executablePath: '/tmp/non-existent-agy-binary-xyz'
    });

    await expect(adapter.generate({ prompt: 'test' })).rejects.toThrow(ExecutableNotFoundError);
  });

  it('parses valid JSON response from agy CLI', async () => {
    // Create a mock executable script that outputs valid agy JSON
    const tempScript = path.join(os.tmpdir(), `mock-agy-success-${Date.now()}.sh`);
    const scriptContent = `#!/bin/sh
cat << 'EOF'
{"conversation_id":"mock-123","status":"SUCCESS","response":"graph TD; A-->B;","duration_seconds":1.2,"usage":{"input_tokens":10,"output_tokens":20,"total_tokens":30}}
EOF
exit 0
`;
    await fs.writeFile(tempScript, scriptContent, { mode: 0o755 });

    try {
      const adapter = new AntigravityCliAdapter({
        executablePath: tempScript
      });

      const result = await adapter.generate({ prompt: 'test' });
      expect(result.text).toBe('graph TD; A-->B;');
      expect(result.metadata?.provider).toBe('antigravity-cli');
      expect(result.metadata?.durationMs).toBe(1200);
      expect(result.metadata?.tokens?.total).toBe(30);
    } finally {
      await fs.unlink(tempScript).catch(() => {});
    }
  });

  it('throws MalformedOutputError when output is invalid JSON', async () => {
    const tempScript = path.join(os.tmpdir(), `mock-agy-badjson-${Date.now()}.sh`);
    const scriptContent = `#!/bin/sh
echo "This is not JSON"
exit 0
`;
    await fs.writeFile(tempScript, scriptContent, { mode: 0o755 });

    try {
      const adapter = new AntigravityCliAdapter({
        executablePath: tempScript
      });

      await expect(adapter.generate({ prompt: 'test' })).rejects.toThrow(MalformedOutputError);
    } finally {
      await fs.unlink(tempScript).catch(() => {});
    }
  });

  it('throws AuthenticationOrConfigError when auth error is in output', async () => {
    const tempScript = path.join(os.tmpdir(), `mock-agy-auth-${Date.now()}.sh`);
    const scriptContent = `#!/bin/sh
echo "Error: Unauthorized - invalid api key provided" >&2
exit 1
`;
    await fs.writeFile(tempScript, scriptContent, { mode: 0o755 });

    try {
      const adapter = new AntigravityCliAdapter({
        executablePath: tempScript
      });

      await expect(adapter.generate({ prompt: 'test' })).rejects.toThrow(
        AuthenticationOrConfigError
      );
    } finally {
      await fs.unlink(tempScript).catch(() => {});
    }
  });

  it('throws NonZeroExitError on unexpected exit code', async () => {
    const tempScript = path.join(os.tmpdir(), `mock-agy-nonzero-${Date.now()}.sh`);
    const scriptContent = `#!/bin/sh
echo "Internal server error" >&2
exit 42
`;
    await fs.writeFile(tempScript, scriptContent, { mode: 0o755 });

    try {
      const adapter = new AntigravityCliAdapter({
        executablePath: tempScript
      });

      await expect(adapter.generate({ prompt: 'test' })).rejects.toThrow(NonZeroExitError);
    } finally {
      await fs.unlink(tempScript).catch(() => {});
    }
  });

  it('throws CliExecutionTimeoutError when execution exceeds timeoutMs', async () => {
    const tempScript = path.join(os.tmpdir(), `mock-agy-sleep-${Date.now()}.sh`);
    const scriptContent = `#!/bin/sh
sleep 2
exit 0
`;
    await fs.writeFile(tempScript, scriptContent, { mode: 0o755 });

    try {
      const adapter = new AntigravityCliAdapter({
        executablePath: tempScript,
        defaultTimeoutMs: 100
      });

      await expect(adapter.generate({ prompt: 'test' })).rejects.toThrow(CliExecutionTimeoutError);
    } finally {
      await fs.unlink(tempScript).catch(() => {});
    }
  });

  it('passes --model flag to spawned CLI args and populates metadata.model when model option is set', async () => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tempScript = path.join(os.tmpdir(), `mock-agy-model-${id}.sh`);
    const captureFile = path.join(os.tmpdir(), `mock-agy-args-${id}.txt`);
    const scriptContent = `#!/bin/sh
for arg in "$@"; do
  printf '%s\\n' "$arg" >> "${captureFile}"
done
cat << 'EOF'
{"conversation_id":"mock-123","status":"SUCCESS","response":"graph TD; A-->B;","duration_seconds":1.2}
EOF
exit 0
`;
    await fs.writeFile(tempScript, scriptContent, { mode: 0o755 });

    try {
      const adapter = new AntigravityCliAdapter({
        executablePath: tempScript,
        model: 'gemini-3.1-pro-high'
      });

      const result = await adapter.generate({ prompt: 'generate diagram' });

      expect(result.text).toBe('graph TD; A-->B;');
      expect(result.metadata?.model).toBe('gemini-3.1-pro-high');

      const capturedRaw = await fs.readFile(captureFile, 'utf-8');
      const capturedArgs = capturedRaw.trim().split('\n');

      expect(capturedArgs).toContain('--model');
      const modelIndex = capturedArgs.indexOf('--model');
      expect(capturedArgs[modelIndex + 1]).toBe('gemini-3.1-pro-high');
      const pIndex = capturedArgs.indexOf('-p');
      expect(modelIndex).toBeLessThan(pIndex);
    } finally {
      await fs.unlink(tempScript).catch(() => {});
      await fs.unlink(captureFile).catch(() => {});
    }
  });

  it('does not pass --model flag and leaves metadata.model undefined when model option is unset', async () => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tempScript = path.join(os.tmpdir(), `mock-agy-nomodel-${id}.sh`);
    const captureFile = path.join(os.tmpdir(), `mock-agy-args-${id}.txt`);
    const scriptContent = `#!/bin/sh
for arg in "$@"; do
  printf '%s\\n' "$arg" >> "${captureFile}"
done
cat << 'EOF'
{"conversation_id":"mock-123","status":"SUCCESS","response":"graph TD; A-->B;","duration_seconds":1.2}
EOF
exit 0
`;
    await fs.writeFile(tempScript, scriptContent, { mode: 0o755 });

    try {
      const adapter = new AntigravityCliAdapter({
        executablePath: tempScript
      });

      const result = await adapter.generate({ prompt: 'generate diagram' });

      expect(result.text).toBe('graph TD; A-->B;');
      expect(result.metadata?.model).toBeUndefined();

      const capturedRaw = await fs.readFile(captureFile, 'utf-8');
      const capturedArgs = capturedRaw.trim().split('\n');

      expect(capturedArgs).not.toContain('--model');
    } finally {
      await fs.unlink(tempScript).catch(() => {});
      await fs.unlink(captureFile).catch(() => {});
    }
  });

  it('populates metadata.model from CLI JSON output response when present', async () => {
    const tempScript = path.join(os.tmpdir(), `mock-agy-outputmodel-${Date.now()}.sh`);
    const scriptContent = `#!/bin/sh
cat << 'EOF'
{"conversation_id":"mock-123","status":"SUCCESS","response":"graph TD; A-->B;","model":"gemini-3.1-pro-from-output","duration_seconds":1.2}
EOF
exit 0
`;
    await fs.writeFile(tempScript, scriptContent, { mode: 0o755 });

    try {
      const adapter = new AntigravityCliAdapter({
        executablePath: tempScript,
        model: 'gemini-3.1-pro-configured'
      });

      const result = await adapter.generate({ prompt: 'test' });
      expect(result.metadata?.model).toBe('gemini-3.1-pro-from-output');
    } finally {
      await fs.unlink(tempScript).catch(() => {});
    }
  });
});
