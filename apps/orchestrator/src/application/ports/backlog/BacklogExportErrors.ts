export class BacklogExportGatewayError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ProviderAuthenticationError extends BacklogExportGatewayError {
  constructor(message = 'Backlog provider authentication failed', cause?: unknown) {
    super(message, cause);
  }
}

export class ProviderRateLimitError extends BacklogExportGatewayError {
  constructor(
    message = 'Backlog provider rate limit exceeded',
    public readonly retryAfterSeconds?: number,
    cause?: unknown
  ) {
    super(message, cause);
  }
}

export class ProviderResourceNotFoundError extends BacklogExportGatewayError {
  constructor(message = 'Backlog provider target resource not found', cause?: unknown) {
    super(message, cause);
  }
}

export class ProviderValidationError extends BacklogExportGatewayError {
  constructor(
    message = 'Backlog provider rejected payload validation',
    public readonly validationErrors?: unknown,
    cause?: unknown
  ) {
    super(message, cause);
  }
}

export class ProviderServerUnavailableError extends BacklogExportGatewayError {
  constructor(message = 'Backlog provider server unavailable', cause?: unknown) {
    super(message, cause);
  }
}

export class ProviderNetworkError extends BacklogExportGatewayError {
  constructor(message = 'Backlog provider network communication failed', cause?: unknown) {
    super(message, cause);
  }
}

export class RealBacklogMutationForbiddenError extends BacklogExportGatewayError {
  constructor(
    message = 'Real backlog mutations are strictly forbidden without explicit operator authorization'
  ) {
    super(message);
  }
}
