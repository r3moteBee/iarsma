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
