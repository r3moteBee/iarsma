/**
 * Centralized mapping from tool names to their required capability scopes.
 *
 * The TOOL_SCOPES constant is the single source of truth for which scope
 * each MCP tool requires. It is consumed by:
 *   - **call-time enforcement**: the dispatcher checks the agent's scope set
 *     against the required scope before invoking a handler.
 *   - **list-time filtering**: the MCP ListTools handler filters out tools
 *     the agent cannot call, so agents only see what they can use.
 *
 * Scope vocabulary follows docs/capability-scopes.md. Each tool requires
 * exactly one scope. If a future tool needs multiple scopes, extend the
 * type to `string | readonly string[]` and update `requiredScope` accordingly.
 */

/**
 * Maps every known tool name to the single scope it requires.
 *
 * Keep this in sync with the tool registrations emitted by the codegen
 * pipeline (`tools/codegen/dist/tools/*.json`). The test file
 * `__tests__/tool-scopes.test.ts` asserts completeness.
 */
export const TOOL_SCOPES: Readonly<Record<string, string>> = {
  'session.get': 'mail:read',
  'mailbox.list': 'mail:read',
  'thread.list': 'mail:read',
  'thread.get': 'mail:read',
  'thread.search': 'mail:read',
  'identity.list': 'mail:read',
  'mail.draft': 'mail:draft',
  'mail.send': 'mail:send',
  'mail.modify': 'mail:modify',
  'mail.delete': 'mail:delete',
  'files.list': 'files:read',
  'files.read': 'files:read',
  'files.propose_write': 'files:write',
} as const;

/**
 * Look up the required scope for a tool by name. Returns `undefined` when
 * the tool is not in the TOOL_SCOPES map (unknown or future tool).
 */
export function requiredScope(toolName: string): string | undefined {
  return TOOL_SCOPES[toolName];
}
