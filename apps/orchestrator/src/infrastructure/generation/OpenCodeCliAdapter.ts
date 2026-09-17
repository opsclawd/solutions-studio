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

export interface OpenCodeCliAdapterOptions {
  executablePath?: string;
  defaultTimeoutMs?: number;
  cwd?: string;
  model?: string;
}

interface OpenCodeEvent {
  type?: string;
  model?: string;
  part?: {
    type?: string;
    text?: string;
    model?: string;
    tokens?: {
      total?: number;
      input?: number;
      output?: number;
      reasoning?: number;
    };
  };
  tokens?: {
    total?: number;
    input?: number;
    output?: number;
    reasoning?: number;
  };
}

export class OpenCodeCliAdapter implements IGenerationGateway {
  private readonly executablePath: string;
  private readonly defaultTimeoutMs: number;
  private readonly cwd?: string;
  private readonly model?: string;

  constructor(options?: OpenCodeCliAdapterOptions) {
    this.executablePath = options?.executablePath ?? process.env.OPENCODE_BIN_PATH ?? 'opencode';
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

    const args = ['run', '--format', 'json', '--pure'];
    if (this.model) {
      args.push('-m', this.model);
    }
    args.push(promptText);

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
          const combined = `${stderrData}\n${stdoutData}`.trim();
          if (/auth|unauthorized|api[ _-]?key|login|credentials|token/i.test(combined)) {
            return reject(new AuthenticationOrConfigError(combined));
          }
          return reject(new NonZeroExitError(code, stderrData, stdoutData));
        }

        try {
          const extracted = this.parseOpenCodeOutput(stdoutData);
          if (!extracted.text.trim()) {
            return reject(
              new MalformedOutputError('opencode produced empty text output', stdoutData)
            );
          }

          resolve({
            text: extracted.text,
            metadata: {
              provider: 'opencode-cli',
              model: extracted.model ?? this.model,
              tokens: extracted.tokens
            }
          });
        } catch (err) {
          if (err instanceof MalformedOutputError) {
            return reject(err);
          }
          reject(
            new MalformedOutputError(
              `Failed to parse opencode output: ${(err as Error).message}`,
              stdoutData,
              err
            )
          );
        }
      });
    });
  }

  private parseOpenCodeOutput(rawOutput: string): {
    text: string;
    model?: string;
    tokens?: {
      input?: number;
      output?: number;
      thinking?: number;
      total?: number;
    };
  } {
    const lines = rawOutput.split('\n');
    let collectedText = '';
    let structuredEventsDetected = false;
    let detectedModel: string | undefined;
    let totalTokens:
      | {
          input?: number;
          output?: number;
          thinking?: number;
          total?: number;
        }
      | undefined;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
        continue;
      }

      try {
        const parsed = JSON.parse(trimmed) as OpenCodeEvent;
        structuredEventsDetected = true;
        if (parsed.model) {
          detectedModel = parsed.model;
        } else if (parsed.part?.model) {
          detectedModel = parsed.part.model;
        }
        if (parsed.type === 'text' && parsed.part?.text) {
          collectedText += parsed.part.text;
        }

        const tok = parsed.tokens || parsed.part?.tokens;
        if (tok) {
          totalTokens = {
            input: tok.input,
            output: tok.output,
            thinking: tok.reasoning,
            total: tok.total
          };
        }
      } catch {
        // Skip unparseable NDJSON lines
      }
    }

    if (structuredEventsDetected) {
      const cleaned = this.stripThinkingBlocks(collectedText);
      if (!cleaned) {
        throw new MalformedOutputError(
          'Structured NDJSON events were detected but no usable text event was produced',
          rawOutput
        );
      }
      return {
        text: cleaned,
        model: detectedModel,
        tokens: totalTokens
      };
    }

    throw new MalformedOutputError(
      'No structured NDJSON events detected in opencode output',
      rawOutput
    );
  }

  private stripThinkingBlocks(text: string): string {
    return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }
}
