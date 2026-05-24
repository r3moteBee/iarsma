/**
 * OpenInference export layer for iarsma action-log entries.
 *
 * Maps `StoredEntry` records to OI-compatible span objects suitable for
 * piping into observability platforms (Phoenix, Arize, LangFuse).
 *
 * The authoritative audit store remains the action-log hash-chain; this
 * module is a read-only projection for telemetry consumers.
 */

import type { StoredEntry } from './action-log.js';

export type OISpan = {
  readonly name: string;
  readonly span_kind: 'CHAIN' | 'TOOL';
  readonly start_time: string;
  readonly attributes: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly input?: { readonly value: string };
  readonly output?: { readonly value: string };
};

export function exportToOpenInference(entries: readonly StoredEntry[]): readonly OISpan[] {
  return entries.map((entry): OISpan => {
    const d = entry.data;
    const spanKind = d.mode === 'commit' ? 'CHAIN' : 'TOOL';

    return {
      name: d.action,
      span_kind: spanKind,
      start_time: new Date(d.timestampMs).toISOString(),
      attributes: {
        'caller_class': d.callerClass,
        'identity': d.identity,
        ...(d.mode !== undefined ? { 'mode': d.mode } : {}),
        'iarsma.schema_version': d.schemaVersion,
        'iarsma.hash_hex': entry.hashHex,
        'iarsma.prev_hash_hex': entry.prevHashHex,
        ...(d.provenance?.previewHashHex !== undefined
          ? { 'iarsma.preview_hash_hex': d.provenance.previewHashHex }
          : {}),
        ...(d.agentTokenId !== undefined
          ? { 'iarsma.agent_token_id': d.agentTokenId }
          : {}),
      },
      input: { value: d.paramsJson },
      ...(d.provenance?.affectedJson !== undefined
        ? { output: { value: d.provenance.affectedJson } }
        : {}),
    };
  });
}
