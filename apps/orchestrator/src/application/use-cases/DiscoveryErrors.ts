export class DiscoveryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnknownProjectionError extends DiscoveryError {
  constructor(public readonly projectionId: string) {
    super(`Unknown projection record: '${projectionId}'`);
  }
}

export class ProjectionBaselineMismatchError extends DiscoveryError {
  constructor(
    public readonly projectionId: string,
    public readonly projectionBaselineId: string,
    public readonly expectedBaselineId: string
  ) {
    super(
      `Projection '${projectionId}' belongs to baseline '${projectionBaselineId}', but '${expectedBaselineId}' was specified`
    );
  }
}

export class RequirementAlreadyExistsError extends DiscoveryError {
  constructor(public readonly requirementId: string) {
    super(
      `Requirement '${requirementId}' already exists. Reviewer discoveries can only create new requirements.`
    );
  }
}
