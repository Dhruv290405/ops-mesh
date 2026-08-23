import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface RequestContext {
  requestId: string;
  actorId?: string;
  actorEmail?: string;
  role?: string;
  startedAt: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getContext(): RequestContext {
  const ctx = storage.getStore();
  return (
    ctx ?? {
      requestId: `req_${randomUUID().slice(0, 8)}`,
      startedAt: Date.now()
    }
  );
}

export function getRequestId(): string {
  return getContext().requestId;
}

export function createContext(partial: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: `req_${randomUUID().slice(0, 8)}`,
    startedAt: Date.now(),
    ...partial
  };
}