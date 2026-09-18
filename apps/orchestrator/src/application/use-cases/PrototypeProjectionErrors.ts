export { RepairRetryExhaustionError } from './RepairErrors.js';

export class PrototypeProvenanceValidationError extends Error {
  constructor(
    message: string,
    public readonly invalidRequirementRevisionIds: readonly string[],
    public readonly allowedRequirementRevisionIds: readonly string[],
    public readonly baselineId: string
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
