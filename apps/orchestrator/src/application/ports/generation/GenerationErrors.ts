export class GenerationGatewayError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ExecutableNotFoundError extends GenerationGatewayError {
  constructor(
    public readonly executableName: string,
    cause?: unknown
  ) {
    super(`Generation CLI executable not found: '${executableName}'`, cause);
  }
}

export class AuthenticationOrConfigError extends GenerationGatewayError {
  constructor(message: string, cause?: unknown) {
    super(`Authentication or configuration error: ${message}`, cause);
  }
}

export class CliExecutionTimeoutError extends GenerationGatewayError {
  constructor(
    public readonly timeoutMs: number,
    cause?: unknown
  ) {
    super(`CLI execution timed out after ${timeoutMs}ms`, cause);
  }
}

export class NonZeroExitError extends GenerationGatewayError {
  constructor(
    public readonly exitCode: number | null,
    public readonly stderr: string,
    public readonly stdout: string,
    cause?: unknown
  ) {
    super(`CLI exited with non-zero code (${exitCode ?? 'null'}). Stderr: ${stderr.trim()}`, cause);
  }
}

export class MalformedOutputError extends GenerationGatewayError {
  constructor(
    message: string,
    public readonly rawOutput: string,
    cause?: unknown
  ) {
    super(`Malformed or unexpected CLI output: ${message}`, cause);
  }
}
