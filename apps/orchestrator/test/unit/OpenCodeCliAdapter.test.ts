import { describe, it, expect } from 'vitest';
import { OpenCodeCliAdapter } from '../../src/infrastructure/generation/OpenCodeCliAdapter.js';
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

describe('OpenCodeCliAdapter', () => {
  it('throws ExecutableNotFoundError when binary does not exist', async () => {
    const adapter = new OpenCodeCliAdapter({
      executablePath: '/tmp/non-existent-opencode-binary-xyz'
    });

    await expect(adapter.generate({ prompt: 'test' })).rejects.toThrow(ExecutableNotFoundError);
  });

  it('parses NDJSON stream and strips <think> blocks', async () => {
    const tempScript = path.join(os.tmpdir(), `mock-opencode-ndjson-${Date.now()}.sh`);
    const scriptContent = `#!/bin/sh
cat << 'EOF'
{"type":"step_start","timestamp":100}
{"type":"text","part":{"type":"text","text":"<think>Internal reasoning</think>\\ngraph TD;\\n  A-->B;"}}
{"type":"step_finish","part":{"tokens":{"input":15,"output":25,"total":40}}}
EOF
exit 0
`;
    await fs.writeFile(tempScript, scriptContent, { mode: 0o755 });

    try {
      const adapter = new OpenCodeCliAdapter({
        executablePath: tempScript
      });

      const result = await adapter.generate({ prompt: 'test' });
      expect(result.text).toBe('graph TD;\n  A-->B;');
      expect(result.metadata?.provider).toBe('opencode-cli');
      expect(result.metadata?.tokens?.total).toBe(40);
    } finally {
      await fs.unlink(tempScript).catch(() => {});
    }
  });

  it('throws MalformedOutputError when structured NDJSON contains no text event', async () => {
    const tempScript = path.join(os.tmpdir(), `mock-opencode-notext-${Date.now()}.sh`);
    const scriptContent = `#!/bin/sh
cat << 'EOF'
{"type":"step_start","timestamp":100}
{"type":"step_finish","part":{"tokens":{"input":15,"output":0,"total":15}}}
EOF
exit 0
`;
    await fs.writeFile(tempScript, scriptContent, { mode: 0o755 });

    try {
      const adapter = new OpenCodeCliAdapter({
        executablePath: tempScript
      });

      await expect(adapter.generate({ prompt: 'test' })).rejects.toThrow(MalformedOutputError);
    } finally {
      await fs.unlink(tempScript).catch(() => {});
    }
  });

  it('throws MalformedOutputError when text event contains only thinking tags and no usable text', async () => {
    const tempScript = path.join(os.tmpdir(), `mock-opencode-onlythink-${Date.now()}.sh`);
    const scriptContent = `#!/bin/sh
cat << 'EOF'
{"type":"step_start","timestamp":100}
{"type":"text","part":{"type":"text","text":"<think>Only thinking here, no response text</think>"}}
{"type":"step_finish","part":{"tokens":{"input":15,"output":10,"total":25}}}
EOF
exit 0
`;
    await fs.writeFile(tempScript, scriptContent, { mode: 0o755 });

    try {
      const adapter = new OpenCodeCliAdapter({
        executablePath: tempScript
      });

      await expect(adapter.generate({ prompt: 'test' })).rejects.toThrow(MalformedOutputError);
    } finally {
      await fs.unlink(tempScript).catch(() => {});
    }
  });

  it('throws MalformedOutputError when output is empty', async () => {
    const tempScript = path.join(os.tmpdir(), `mock-opencode-empty-${Date.now()}.sh`);
    const scriptContent = `#!/bin/sh
exit 0
`;
    await fs.writeFile(tempScript, scriptContent, { mode: 0o755 });

    try {
      const adapter = new OpenCodeCliAdapter({
        executablePath: tempScript
      });

      await expect(adapter.generate({ prompt: 'test' })).rejects.toThrow(MalformedOutputError);
    } finally {
      await fs.unlink(tempScript).catch(() => {});
    }
  });

  it('throws AuthenticationOrConfigError on credentials error', async () => {
    const tempScript = path.join(os.tmpdir(), `mock-opencode-auth-${Date.now()}.sh`);
    const scriptContent = `#!/bin/sh
echo "Error: authentication failed for provider. Token missing." >&2
exit 1
`;
    await fs.writeFile(tempScript, scriptContent, { mode: 0o755 });

    try {
      const adapter = new OpenCodeCliAdapter({
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
    const tempScript = path.join(os.tmpdir(), `mock-opencode-fail-${Date.now()}.sh`);
    const scriptContent = `#!/bin/sh
echo "Unhandled crash" >&2
exit 99
`;
    await fs.writeFile(tempScript, scriptContent, { mode: 0o755 });

    try {
      const adapter = new OpenCodeCliAdapter({
        executablePath: tempScript
      });

      await expect(adapter.generate({ prompt: 'test' })).rejects.toThrow(NonZeroExitError);
    } finally {
      await fs.unlink(tempScript).catch(() => {});
    }
  });

  it('throws CliExecutionTimeoutError when execution exceeds timeoutMs', async () => {
    const tempScript = path.join(os.tmpdir(), `mock-opencode-sleep-${Date.now()}.sh`);
    const scriptContent = `#!/bin/sh
sleep 2
exit 0
`;
    await fs.writeFile(tempScript, scriptContent, { mode: 0o755 });

    try {
      const adapter = new OpenCodeCliAdapter({
        executablePath: tempScript,
        defaultTimeoutMs: 100
      });

      await expect(adapter.generate({ prompt: 'test' })).rejects.toThrow(CliExecutionTimeoutError);
    } finally {
      await fs.unlink(tempScript).catch(() => {});
    }
  });
});
