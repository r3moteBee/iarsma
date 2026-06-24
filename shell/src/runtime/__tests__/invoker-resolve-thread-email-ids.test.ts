import { describe, expect, it, vi } from 'vitest';
import { cachedInvoker } from '../cached-invoker.js';
import { inMemoryCacheStorage } from '../cache-storage.js';
import type { Invoker } from '../invoker.js';

function innerWithResolver(
  map: ReadonlyMap<string, readonly string[]>,
): Invoker {
  return {
    async invoke() {
      throw new Error('not used');
    },
    resolveThreadEmailIds: vi.fn(async () => map),
  };
}

describe('cachedInvoker forwards resolveThreadEmailIds', () => {
  it('passes through to the inner invoker', async () => {
    const inner = innerWithResolver(new Map([['T1', ['E1', 'E2']]]));
    const wrapped = cachedInvoker({ inner, store: inMemoryCacheStorage() });
    const out = await wrapped.resolveThreadEmailIds!(['T1']);
    expect([...out.get('T1')!]).toEqual(['E1', 'E2']);
    expect(inner.resolveThreadEmailIds).toHaveBeenCalledWith(['T1']);
  });

  it('omits the method when the inner invoker lacks it', () => {
    const inner: Invoker = {
      async invoke() {
        return undefined as never;
      },
    };
    const wrapped = cachedInvoker({ inner, store: inMemoryCacheStorage() });
    expect(wrapped.resolveThreadEmailIds).toBeUndefined();
  });
});
