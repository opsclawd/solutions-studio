export interface AuthenticationErrorDetails {
  readonly reason?: string;
  readonly [key: string]: unknown;
}

export class AuthenticationError extends Error {
  readonly statusCode = 401;
  readonly details?: AuthenticationErrorDetails;

  constructor(message: string, details?: AuthenticationErrorDetails) {
    super(message);
    this.name = 'AuthenticationError';
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ForbiddenError extends Error {
  readonly statusCode = 403;
  readonly requiredCapability: string;
  readonly actorId?: string;

  constructor(message: string, requiredCapability: string, actorId?: string) {
    super(message);
    this.name = 'ForbiddenError';
    this.requiredCapability = requiredCapability;
    this.actorId = actorId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
