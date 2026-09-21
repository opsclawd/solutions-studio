export type OperationalEvent =
  | 'http.request.completed'
  | 'identity.actor.authenticated'
  | 'command.executed'
  | 'generation.call.completed'
  | 'validation.executed'
  | 'persistence.operation.completed'
  | 'backlog.export.completed'
  | 'governance.approval.recorded';

export interface IOperationalLogger {
  log(
    event: OperationalEvent,
    details: Record<string, unknown>,
    options?: {
      level?: 'info' | 'warn' | 'error';
      actorId?: string;
      correlationId?: string;
    }
  ): void;
}
