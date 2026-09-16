export class CompilationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class EmptySourceRevisionIdsError extends CompilationError {
  constructor(message = 'CompileRequirementsUseCase requires at least one sourceRevisionId') {
    super(message);
  }
}

export class MalformedGenerationOutputError extends CompilationError {
  constructor(
    public readonly rawOutput: string,
    public readonly issues?: unknown,
    cause?: unknown
  ) {
    super(
      'Malformed generation output: failed to parse structured response',
      cause !== undefined ? { cause } : undefined
    );
  }
}

export class UnsafeIdentifierError extends CompilationError {
  constructor(
    public readonly identifier: string,
    message?: string,
    options?: ErrorOptions
  ) {
    super(message ?? `Unsafe identifier rejected: '${identifier}'`, options);
  }
}

export class UnknownSourceRevisionError extends CompilationError {
  constructor(
    public readonly sourceRevisionId: string,
    message?: string,
    options?: ErrorOptions
  ) {
    super(message ?? `Unknown source revision: '${sourceRevisionId}'`, options);
  }
}

export class UnresolvedLocatorError extends CompilationError {
  constructor(
    public readonly sourceRevisionId: string,
    public readonly locator: string,
    message?: string,
    options?: ErrorOptions
  ) {
    super(
      message ??
        `Locator '${locator}' could not be resolved for source revision '${sourceRevisionId}'`,
      options
    );
  }
}

export class InvalidEvidencelessOriginError extends CompilationError {
  constructor(
    public readonly requirementKey: string,
    public readonly origin: string,
    message?: string
  ) {
    super(
      message ??
        `Candidate requirement '${requirementKey}' with origin '${origin}' must have at least one evidence reference`
    );
  }
}
