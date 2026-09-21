import { spawn } from 'node:child_process';
import type {
  IGenerationGateway,
  GenerationRequest,
  GenerationResult
} from '../../application/ports/generation/IGenerationGateway.js';
import {
  ExecutableNotFoundError,
  AuthenticationOrConfigError,
  CliExecutionTimeoutError,
  NonZeroExitError,
  MalformedOutputError
} from '../../application/ports/generation/GenerationErrors.js';

export interface AntigravityCliAdapterOptions {
  executablePath?: string;
  defaultTimeoutMs?: number;
  cwd?: string;
  model?: string;
}

interface AgyJsonOutput {
  conversation_id?: string;
  status?: string;
  response?: string;
  duration_seconds?: number;
  num_turns?: number;
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    thinking_tokens?: number;
    cache_read_tokens?: number;
    total_tokens?: number;
  };
  error?: string;
}

export class AntigravityCliAdapter implements IGenerationGateway {
  private readonly executablePath: string;
  private readonly defaultTimeoutMs: number;
  private readonly cwd?: string;
  private readonly model?: string;

  constructor(options?: AntigravityCliAdapterOptions) {
    this.executablePath = options?.executablePath ?? process.env.AGY_BIN_PATH ?? 'agy';
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 90_000;
    this.cwd = options?.cwd;
    this.model = options?.model;
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const systemInstruction =
      request.systemPrompt ??
      'System: You are an automated artifact generation engine. Output ONLY the raw requested text without using any tools, running commands, or providing conversational commentary.';
    const promptText = `${systemInstruction}\n\n${request.prompt}`;

    const args = ['--output-format', 'json', '--dangerously-skip-permissions'];
    if (this.model) {
      args.push('--model', this.model);
    }
    args.push('-p', promptText);

    return new Promise((resolve, reject) => {
      let stdoutData = '';
      let stderrData = '';
      let timedOut = false;

      const child = spawn(this.executablePath, args, {
        cwd: this.cwd,
        env: { ...process.env }
      });

      child.stdin?.end();

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
        reject(new CliExecutionTimeoutError(timeoutMs));
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdoutData += chunk.toString('utf-8');
      });

      child.stderr.on('data', (chunk) => {
        stderrData += chunk.toString('utf-8');
      });

      child.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (err.code === 'ENOENT') {
          reject(new ExecutableNotFoundError(this.executablePath, err));
        } else {
          reject(new NonZeroExitError(null, err.message, stdoutData, err));
        }
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) return;

        if (code !== 0) {
          const combinedErr = `${stderrData}\n${stdoutData}`.trim();
          if (/auth|unauthorized|api[ _-]?key|login|credentials|token/i.test(combinedErr)) {
            return reject(new AuthenticationOrConfigError(combinedErr));
          }
          return reject(new NonZeroExitError(code, stderrData, stdoutData));
        }

        try {
          // agy stdout might have leading/trailing newlines or diagnostic lines
          const trimmedStdout = stdoutData.trim();
          if (!trimmedStdout) {
            return reject(new MalformedOutputError('agy produced empty stdout', stdoutData));
          }

          // In case of any leading warnings before the JSON object, extract JSON substring
          const jsonStart = trimmedStdout.indexOf('{');
          const jsonEnd = trimmedStdout.lastIndexOf('}');
          if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
            return reject(
              new MalformedOutputError('agy output contains no JSON object', stdoutData)
            );
          }

          const jsonSlice = trimmedStdout.substring(jsonStart, jsonEnd + 1);
          const parsed = JSON.parse(jsonSlice) as AgyJsonOutput;

          if (parsed.status && parsed.status !== 'SUCCESS') {
            const errMsg = parsed.error || `Status was ${parsed.status}`;
            if (/auth|unauthorized|key|login/i.test(errMsg)) {
              return reject(new AuthenticationOrConfigError(errMsg));
            }
            return reject(new MalformedOutputError(errMsg, stdoutData));
          }

          if (typeof parsed.response !== 'string') {
            return reject(
              new MalformedOutputError(
                'Missing or non-string "response" property in JSON',
                stdoutData
              )
            );
          }

          resolve({
            text: parsed.response,
            metadata: {
              provider: 'antigravity-cli',
              model: parsed.model ?? this.model,
              durationMs: parsed.duration_seconds
                ? Math.round(parsed.duration_seconds * 1000)
                : undefined,
              tokens: parsed.usage
                ? {
                    input: parsed.usage.input_tokens,
                    output: parsed.usage.output_tokens,
                    thinking: parsed.usage.thinking_tokens,
                    total: parsed.usage.total_tokens
                  }
                : undefined,
              raw: parsed
            }
          });
        } catch (err) {
          reject(
            new MalformedOutputError(
              `Failed to parse agy JSON: ${(err as Error).message}`,
              stdoutData,
              err
            )
          );
        }
      });
    });
  }

  async checkHealth(): Promise<{
    status: 'healthy' | 'unhealthy' | 'degraded';
    provider: string;
    available: boolean;
    latencyMs?: number;
    error?: string;
  }> {
    const start = Date.now();
    return new Promise((resolve) => {
      let resolved = false;
      const done = (report: {
        status: 'healthy' | 'unhealthy' | 'degraded';
        provider: string;
        available: boolean;
        latencyMs?: number;
        error?: string;
      }) => {
        if (!resolved) {
          resolved = true;
          resolve(report);
        }
      };

      try {
        const child = spawn(this.executablePath, ['--version'], {
          cwd: this.cwd,
          stdio: ['ignore', 'pipe', 'pipe']
        });

        const timer = setTimeout(() => {
          child.kill();
          done({
            status: 'unhealthy',
            provider: 'agy',
            available: false,
            latencyMs: Date.now() - start,
            error: `Timeout probing executable '${this.executablePath}'`
          });
        }, 3000);

        child.on('error', (err) => {
          clearTimeout(timer);
          done({
            status: 'unhealthy',
            provider: 'agy',
            available: false,
            latencyMs: Date.now() - start,
            error: `Executable '${this.executablePath}' not found or cannot be spawned: ${err.message}`
          });
        });

        child.on('close', (code) => {
          clearTimeout(timer);
          if (code === 0) {
            done({
              status: 'healthy',
              provider: 'agy',
              available: true,
              latencyMs: Date.now() - start
            });
          } else {
            done({
              status: 'unhealthy',
              provider: 'agy',
              available: false,
              latencyMs: Date.now() - start,
              error: `Executable '${this.executablePath}' exited with code ${code}`
            });
          }
        });
      } catch (err) {
        done({
          status: 'unhealthy',
          provider: 'agy',
          available: false,
          latencyMs: Date.now() - start,
          error: (err as Error).message
        });
      }
    });
  }
}
