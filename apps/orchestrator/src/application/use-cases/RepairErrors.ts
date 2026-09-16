export class RepairRetryExhaustionError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastCandidate: string,
    public readonly errors: string[]
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
