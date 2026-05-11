/**
 * @iarsma/shell-runtime — public surface used by generated hooks and by
 * the application bootstrap.
 *
 * Generated hooks import `useReadHook` / `useWriteHook` from here. The app
 * mounts an `<IarsmaProvider invoker={...}>` at the root and picks an
 * invoker (mcp, jmap-direct, or mock) based on config.
 */

export type { AsyncResult, DryRunPreview, PolicyDecision, ToolConfig, ToolError } from './types.js';
export { toToolError } from './types.js';

export { canonicalize } from './canonical.js';

export {
  IarsmaProvider,
  useInvoker,
  mcpInvoker,
  jmapInvoker,
  mockInvoker,
} from './invoker.js';
export type {
  Invoker,
  InvocationOptions,
  JmapInvokerOptions,
  McpInvokerOptions,
  MockInvokerHandler,
} from './invoker.js';

export { fetchSession, parseSession } from './jmap-client.js';
export type { JmapClientOptions, Session } from './jmap-client.js';

export {
  createActionLog,
  inMemoryActionLogStore,
  webCryptoSha384,
} from './action-log.js';
export type {
  ActionLog,
  ActionLogOptions,
  ActionLogStore,
  AppendInput,
  ChainVerificationError,
  EntryInput,
  Identity,
  Sha384,
  StoredEntry,
} from './action-log.js';

export { useReadHook } from './read-hook.js';
export type { UseReadHookOptions, UseReadHookResult } from './read-hook.js';

export { useWriteHook } from './write-hook.js';
export type { UseWriteHookOptions, UseWriteHookResult } from './write-hook.js';

// `sanitizer.ts` and `sanitize-fragment.ts` are NOT re-exported here:
// they import the `@iarsma/wasm-bindings/html-sanitizer` module
// eagerly, which trips jsdom (WASM fetch with a non-`file:` URL) for
// any test that imports from this barrel. Direct callers (MessageView
// in thread-view.tsx, Composer in composer.tsx) import them by name
// from `../runtime/sanitizer.js` / `../runtime/sanitize-fragment.js`.

export {
  CACHE_PURPOSES,
  inMemoryCacheStorage,
  indexedDbCacheStorage,
} from './cache-storage.js';
export type {
  CacheStorage,
  CachePurposeKey,
  IndexedDbCacheStorageOptions,
} from './cache-storage.js';
export { CACHEABLE_TOOLS, purposeFor } from './cache-policy.js';
export { cachedInvoker } from './cached-invoker.js';
export type { CachedInvokerOptions } from './cached-invoker.js';

export { indexedDbActionLogStore } from './action-log-store.js';
export type { IndexedDbActionLogStoreOptions } from './action-log-store.js';
export { EXCLUDED_FROM_LOG, isLoggable } from './loggable-tools.js';
export { loggingInvoker } from './logging-invoker.js';
export type { LoggingInvokerOptions } from './logging-invoker.js';
export type { CallerClass, CallMode } from './action-log.js';
