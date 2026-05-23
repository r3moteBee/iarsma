/**
 * Destructive-tool catalog + affected-artifact builders (D-047,
 * Phase 2 work item 12).
 *
 * The action log records destructive commits with `mode: 'commit'`
 * and a `provenance` object carrying:
 *
 *   - `affectedJson`: JSON-encoded list of `{kind, id, op}` records —
 *     the artifacts the commit produced. Per-tool builders derive
 *     this from the commit's `output` because each tool's result has
 *     a different shape.
 *   - `previewHashHex`: SHA-384 of the canonical-form dry-run output
 *     the user approved. Combined with the chain-anchored entry it
 *     proves "what was committed matches what was shown."
 *
 * Adding a destructive capability:
 *   1. Add the tool name to `DESTRUCTIVE_TOOLS`.
 *   2. Add a builder to `AFFECTED_JSON_BUILDERS` that translates the
 *      commit's `output` into the affected-json string. Mirror the
 *      builder shape — keep `kind` / `op` lowercase, `id` the
 *      server-stamped artifact id.
 *
 * Future capabilities that mutate without producing a server-side
 * artifact (e.g., `mailbox.move`, `keyword.set`) still appear in
 * DESTRUCTIVE_TOOLS but their builders emit op="modify" against the
 * mutated id rather than op="create".
 */

export const DESTRUCTIVE_TOOLS: ReadonlySet<string> = new Set([
  'mail.delete',
  'mail.draft',
  'mail.modify',
  'mail.send',
]);

export function isDestructive(toolName: string): boolean {
  return DESTRUCTIVE_TOOLS.has(toolName);
}

export type AffectedArtifact = {
  readonly kind: string;
  readonly id: string;
  readonly op: 'create' | 'modify' | 'delete';
};

export type AffectedJsonBuilder = (output: unknown) => string;

/**
 * Per-tool builder that translates a commit output into the
 * canonical `affectedJson` string. Returns the empty array
 * (stringified) when the output shape doesn't match — the entry is
 * still recorded; only the artifact list is empty.
 */
export const AFFECTED_JSON_BUILDERS: Readonly<
  Record<string, AffectedJsonBuilder>
> = {
  'mail.delete': (_output) => {
    // mail.delete's output only has `deletedCount` — the destroyed ids
    // are not echoed back (the caller already knows them from the input).
    // We still register the builder so the provenance entry records the
    // tool as destructive; the affected-json is an empty array.
    return JSON.stringify([] as AffectedArtifact[]);
  },
  'mail.draft': (output) => {
    const o = output as { emailId?: unknown } | undefined;
    if (o === undefined || typeof o.emailId !== 'string') {
      return JSON.stringify([] as AffectedArtifact[]);
    }
    return JSON.stringify([
      { kind: 'mail', id: o.emailId, op: 'create' } as AffectedArtifact,
    ]);
  },
  'mail.modify': (_output) => {
    // mail.modify's output only has `modifiedCount` — no individual
    // artifact ids are returned by the JMAP Email/set update response.
    // We still register the builder so the provenance entry records the
    // tool as destructive; the affected-json is an empty array.
    return JSON.stringify([] as AffectedArtifact[]);
  },
  'mail.send': (output) => {
    const o = output as { emailId?: unknown; submissionId?: unknown } | undefined;
    if (o === undefined || typeof o.emailId !== 'string') {
      return JSON.stringify([] as AffectedArtifact[]);
    }
    // Both the new Email AND the EmailSubmission count as artifacts
    // — the submission is the relay's commitment to send, separate
    // from the message itself. Future cancellation will operate on
    // the submission id.
    const artifacts: AffectedArtifact[] = [
      { kind: 'mail', id: o.emailId, op: 'create' },
    ];
    if (typeof o.submissionId === 'string') {
      artifacts.push({
        kind: 'mail-submission',
        id: o.submissionId,
        op: 'create',
      });
    }
    return JSON.stringify(artifacts);
  },
};

export function affectedJsonFor(
  toolName: string,
  output: unknown,
): string | undefined {
  const builder = AFFECTED_JSON_BUILDERS[toolName];
  if (builder === undefined) return undefined;
  return builder(output);
}
