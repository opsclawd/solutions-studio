import type { IOperationalLogger, OperationalEvent } from './IOperationalLogger.js';

export class OperationalLogger {
  private static delegate?: IOperationalLogger;

  static setDelegate(delegate: IOperationalLogger | undefined): void {
    this.delegate = delegate;
  }

  static getDelegate(): IOperationalLogger | undefined {
    return this.delegate;
  }

  static log(
    event: OperationalEvent,
    details: Record<string, unknown>,
    options?: {
      level?: 'info' | 'warn' | 'error';
      actorId?: string;
      correlationId?: string;
    }
  ): void {
    this.delegate?.log(event, details, options);
  }
}
