import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';

export interface CorrelationStore {
  readonly correlationId: string;
  actorId?: string;
  readonly startedAt: number;
}

const storage = new AsyncLocalStorage<CorrelationStore>();

export class CorrelationContext {
  static generateCorrelationId(): string {
    return `c-${crypto.randomUUID()}`;
  }

  static getCorrelationId(): string {
    const store = storage.getStore();
    return store?.correlationId ?? this.generateCorrelationId();
  }

  static getStore(): CorrelationStore | undefined {
    return storage.getStore();
  }

  static setActorId(actorId: string): void {
    const store = storage.getStore();
    if (store) {
      store.actorId = actorId;
    }
  }

  static run<T>(correlationId: string, fn: () => T, actorId?: string): T {
    const store: CorrelationStore = {
      correlationId,
      actorId,
      startedAt: Date.now()
    };
    return storage.run(store, fn);
  }
}
