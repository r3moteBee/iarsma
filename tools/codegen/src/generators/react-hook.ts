/**
 * React hook generator. Produces one `.ts` file per capability containing
 * typed `Input` / `Output` aliases plus a hook (`useFooBar`) that calls
 * into the shell runtime (`@iarsma/shell-runtime`).
 *
 * Two shapes (decision 1 from the F-3 design conversation):
 *
 *   - Read-style for non-destructive capabilities: hook auto-fetches and
 *     returns `{ data, error, isLoading, refetch }`.
 *   - Write-style for destructive capabilities: hook returns
 *     `{ preview, commit, isLoading, error, reset }`. Manual trigger.
 *
 * No Zod, no JSON Schema imports — types are inlined from the AST. The
 * runtime trusts that what it sends matches the declared types; output
 * validation, if needed, happens at the invoker boundary (e.g., Ajv against
 * `dist/schemas/*.json` for users who opt into runtime validation).
 */

import type { CapabilityAST } from '../types.js';
import { typeNodeToTypeScript } from './ts-types.js';

/**
 * Generate the `.ts` file body for a capability's React hook.
 * The output is a complete TypeScript module ready to drop into
 * `shell/src/generated/capabilities/<safe-name>.ts`.
 */
export function reactHookForCapability(cap: CapabilityAST): string {
  const inputTs = typeNodeToTypeScript(cap.input);
  const outputTs = typeNodeToTypeScript(cap.output);
  const inputType = pascalCase(cap.name) + 'Input';
  const outputType = pascalCase(cap.name) + 'Output';
  const hookName = `use${pascalCase(cap.name)}`;
  const scopesLiteral = cap.scopes.length === 0
    ? '[] as const'
    : `[${cap.scopes.map((s) => `'${s}'`).join(', ')}] as const`;
  const isDestructive = cap.isDestructive;

  const header = [
    '// Generated from contract: ' + cap.name,
    '// Do not edit by hand — re-run `pnpm codegen` (or `just codegen`).',
    '//',
    '// Description: ' + cap.description.split('\n')[0]!,
    '',
    "import {",
    isDestructive ? '  useWriteHook,' : '  useReadHook,',
    "} from '../../runtime/index.js';",
    '',
  ].join('\n');

  const types = [
    `export type ${inputType} = ${inputTs};`,
    '',
    `export type ${outputType} = ${outputTs};`,
    '',
  ].join('\n');

  const body = isDestructive
    ? renderWriteHook(hookName, cap.name, inputType, outputType, scopesLiteral)
    : renderReadHook(hookName, cap.name, inputType, outputType, scopesLiteral, isEmptyRecordInput(cap));

  return header + '\n' + types + '\n' + body + '\n';
}

function renderReadHook(
  hookName: string,
  capName: string,
  inputType: string,
  outputType: string,
  scopesLiteral: string,
  defaultEmptyInput: boolean,
): string {
  const inputParam = defaultEmptyInput
    ? `input: ${inputType} = {} as ${inputType}`
    : `input: ${inputType}`;
  return [
    '/**',
    ` * React hook for the \`${capName}\` capability.`,
    ' * Auto-fetches on mount and on input change.',
    ' * Cached across components by canonicalized input.',
    ' */',
    `export function ${hookName}(${inputParam}) {`,
    `  return useReadHook<${inputType}, ${outputType}>({`,
    `    name: '${capName}',`,
    `    scopes: ${scopesLiteral},`,
    `    input,`,
    `  });`,
    '}',
  ].join('\n');
}

function renderWriteHook(
  hookName: string,
  capName: string,
  inputType: string,
  outputType: string,
  scopesLiteral: string,
): string {
  return [
    '/**',
    ` * React hook for the \`${capName}\` capability (destructive).`,
    ' * Returns `preview` (dry-run) and `commit` (actual call) functions.',
    ' * Both go through the policy seam server-side.',
    ' */',
    `export function ${hookName}() {`,
    `  return useWriteHook<${inputType}, ${outputType}>({`,
    `    name: '${capName}',`,
    `    scopes: ${scopesLiteral},`,
    `  });`,
    '}',
  ].join('\n');
}

/**
 * Convert a dotted capability name to PascalCase.
 *   'session.get'        → 'SessionGet'
 *   'mail.send'          → 'MailSend'
 *   'mail.draft.create'  → 'MailDraftCreate'
 */
export function pascalCase(name: string): string {
  return name
    .split('.')
    .map((seg) =>
      seg
        .split(/[-_]/)
        .map((p) => (p.length > 0 ? p[0]!.toUpperCase() + p.slice(1) : ''))
        .join(''),
    )
    .join('');
}

/** True if the capability's input is an empty record. Lets us default to `{}`. */
function isEmptyRecordInput(cap: CapabilityAST): boolean {
  return cap.input.kind === 'record' && cap.input.fields.length === 0;
}
