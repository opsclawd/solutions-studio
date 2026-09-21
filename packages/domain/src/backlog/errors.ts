import { DomainError } from '../requirements/errors.js';

export class BacklogDomainError extends DomainError {}

export class StoryNotReadyForExportError extends BacklogDomainError {
  constructor(
    public readonly storyId: string,
    public readonly rejectionReasons: readonly string[] = []
  ) {
    super(
      `Story '${storyId}' is not ready for export: ${
        rejectionReasons.length > 0 ? rejectionReasons.join('; ') : 'failed readiness checks'
      }`
    );
  }
}

export class InvalidBacklogMappingError extends BacklogDomainError {
  constructor(message: string) {
    super(`Invalid backlog export mapping: ${message}`);
  }
}
