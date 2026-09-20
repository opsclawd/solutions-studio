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

export class ProjectionArtifactTypeMismatchError extends DiscoveryError {
  constructor(
    public readonly projectionId: string,
    public readonly projectionArtifactType: string,
    public readonly expectedArtifactType: string
  ) {
    super(
      `Projection '${projectionId}' is of artifact type '${projectionArtifactType}', but '${expectedArtifactType}' was expected`
    );
  }
}

export class ConflictingSqlProjectionAuthorityError extends DiscoveryError {
  constructor(
    public readonly projectionId: string,
    public readonly decisionId: string,
    message: string
  ) {
    super(message);
  }
}

export class RequirementAlreadyExistsError extends DiscoveryError {
  constructor(public readonly requirementId: string) {
    super(
      `Requirement '${requirementId}' already exists. Reviewer discoveries can only create new requirements.`
    );
  }
}
