import type {
  IOperationalLogger,
  OperationalEvent
} from '../../application/ports/observability/IOperationalLogger.js';
import { OperationalLogger } from '../../application/ports/observability/OperationalLogger.js';
import { CorrelationContext } from './CorrelationContext.js';
import { SensitiveDataSanitizer } from './SensitiveDataSanitizer.js';

export type { OperationalEvent };

export interface StructuredLogRecord {
  readonly timestamp: string;
  readonly level: 'info' | 'warn' | 'error';
  readonly correlationId: string;
  readonly event: OperationalEvent;
  readonly actorId?: string;
  readonly details: Record<string, unknown>;
}

export class StructuredOperationalLogger implements IOperationalLogger {
  private static logSink: (record: StructuredLogRecord) => void = (record) => {
    // In production / test environments, writes as single-line JSON to process.stdout or logger
    const line = JSON.stringify(record);
    if (record.level === 'error') {
      console.error(line);
    } else if (record.level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  };

  static setSink(sink: (record: StructuredLogRecord) => void): void {
    this.logSink = sink;
  }

  static resetSink(): void {
    this.logSink = (record) => {
      const line = JSON.stringify(record);
      if (record.level === 'error') {
        console.error(line);
      } else if (record.level === 'warn') {
        console.warn(line);
      } else {
        console.log(line);
      }
    };
  }

  static log(
    event: OperationalEvent,
    details: Record<string, unknown>,
    options: {
      level?: 'info' | 'warn' | 'error';
      actorId?: string;
      correlationId?: string;
    } = {}
  ): StructuredLogRecord {
    const correlationId = options.correlationId ?? CorrelationContext.getCorrelationId();
    const sanitizedDetails = SensitiveDataSanitizer.sanitizeObject(details) as Record<
      string,
      unknown
    >;

    const effectiveActorId =
      options.actorId ??
      (typeof details.actorId === 'string' ? details.actorId : undefined) ??
      CorrelationContext.getStore()?.actorId;
    const sanitizedActorId = effectiveActorId
      ? SensitiveDataSanitizer.sanitizeActorId(effectiveActorId)
      : undefined;

    const record: StructuredLogRecord = {
      timestamp: new Date().toISOString(),
      level: options.level ?? 'info',
      correlationId,
      event,
      actorId: sanitizedActorId,
      details: sanitizedDetails
    };

    this.logSink(record);
    return record;
  }

  log(
    event: OperationalEvent,
    details: Record<string, unknown>,
    options?: {
      level?: 'info' | 'warn' | 'error';
      actorId?: string;
      correlationId?: string;
    }
  ): void {
    StructuredOperationalLogger.log(event, details, options);
  }
}

OperationalLogger.setDelegate(new StructuredOperationalLogger());
