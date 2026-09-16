import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import type {
  IMermaidLinterGateway,
  MermaidValidationResult
} from '../../application/ports/validation/IMermaidLinterGateway.js';

export interface MermaidCliLinterAdapterOptions {
  executablePath?: string;
  timeoutMs?: number;
  puppeteerConfigPath?: string;
}

export class MermaidCliLinterAdapter implements IMermaidLinterGateway {
  private readonly executablePath: string;
  private readonly timeoutMs: number;
  private readonly puppeteerConfigPath?: string;

  constructor(options?: MermaidCliLinterAdapterOptions) {
    this.executablePath =
      options?.executablePath ??
      process.env.MMDC_BIN_PATH ??
      path.resolve(process.cwd(), 'node_modules/.bin/mmdc');
    this.timeoutMs = options?.timeoutMs ?? 15_000;

    const configured = options?.puppeteerConfigPath ?? process.env.PUPPETEER_CONFIG_PATH;
    if (configured && existsSync(configured)) {
      this.puppeteerConfigPath = configured;
    }
  }

  async validate(mermaidCode: string): Promise<MermaidValidationResult> {
    const trimmed = mermaidCode.trim();
    if (!trimmed) {
      return {
        isValid: false,
        errorMessage: 'Empty Mermaid diagram definition'
      };
    }

    const runId = randomUUID();
    const tempDir = os.tmpdir();
    const inputFile = path.join(tempDir, `mermaid_input_${runId}.mmd`);
    const outputFile = path.join(tempDir, `mermaid_output_${runId}.svg`);

    try {
      await fs.writeFile(inputFile, trimmed, 'utf-8');

      const result = await this.runMmdc(inputFile, outputFile);
      if (result.exitCode === 0) {
        return { isValid: true };
      }

      const combinedOutput = `${result.stderr}\n${result.stdout}`;
      const cleanedError = this.cleanErrorMessage(combinedOutput);
      return {
        isValid: false,
        errorMessage: cleanedError || 'Mermaid parsing failed with non-zero exit code'
      };
    } finally {
      await Promise.allSettled([fs.unlink(inputFile), fs.unlink(outputFile)]);
    }
  }

  private runMmdc(
    inputFile: string,
    outputFile: string
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const args = ['-i', inputFile, '-o', outputFile, '-e', 'svg'];
      if (this.puppeteerConfigPath) {
        args.push('-p', this.puppeteerConfigPath);
      }

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const child = spawn(this.executablePath, args, {
        env: { ...process.env }
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
        resolve({
          exitCode: -1,
          stdout,
          stderr: `Mermaid CLI execution timed out after ${this.timeoutMs}ms`
        });
      }, this.timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf-8');
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf-8');
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          exitCode: -1,
          stdout,
          stderr: `Failed to invoke mmdc: ${err.message}`
        });
      });

      child.on('close', (exitCode) => {
        clearTimeout(timer);
        if (timedOut) return;
        resolve({ exitCode, stdout, stderr });
      });
    });
  }

  private cleanErrorMessage(raw: string): string {
    const lines = raw.split('\n');
    const filteredLines: string[] = [];
    let capturingError = false;

    for (const line of lines) {
      const trimmed = line.trim();
      // Suppress informational banners and warnings
      if (
        trimmed.includes('No output format specified') ||
        trimmed.includes('Generating single mermaid chart')
      ) {
        continue;
      }
      if (trimmed.startsWith('Error: Parse error') || trimmed.startsWith('Parse error')) {
        capturingError = true;
      }
      // Stop capturing at stack trace lines
      if (capturingError && (trimmed.startsWith('at ') || trimmed.includes('Parser.parseError'))) {
        break;
      }
      if (capturingError) {
        filteredLines.push(line);
      }
    }

    if (filteredLines.length > 0) {
      return filteredLines.join('\n').trim();
    }

    // Fallback: strip stack traces
    return raw
      .replace(/\s+at .*/g, '')
      .replace(/No output format specified[^\n]*/g, '')
      .replace(/Generating single mermaid chart[^\n]*/g, '')
      .trim();
  }
}
