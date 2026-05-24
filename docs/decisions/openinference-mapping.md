# OpenInference Schema Decision

**Date:** 2026-05-24
**Decision:** Keep custom action-log schema, add OI export layer.

## Context

Iarsma's action-log schema and OpenInference solve different problems:
- **Ours** (audit/integrity): hash-chain, cryptographic provenance (previewHashHex), tamper-evident entries, AAD-domain-separated encrypted storage
- **OpenInference** (observability): span hierarchies, latency tracking, token usage attribution, integration with Phoenix/Arize/LangFuse

## Decision

Keep our custom schema as the authoritative audit store. Add an export function that maps entries to OI-compatible spans for anyone who wants to pipe logs into observability tools.

## Field Mapping

| Iarsma Field | OI Span Attribute |
|---|---|
| action | span.name |
| callerClass | span.attributes["caller_class"] |
| identity | span.attributes["identity"] |
| timestampMs | span.start_time (ISO 8601) |
| mode | span.attributes["mode"] |
| paramsJson | span.input.value |
| provenance.affectedJson | span.output.value |
| provenance.previewHashHex | span.attributes["iarsma.preview_hash_hex"] |
| hashHex | span.attributes["iarsma.hash_hex"] |
| prevHashHex | span.attributes["iarsma.prev_hash_hex"] |
| schemaVersion | span.attributes["iarsma.schema_version"] |
| agentTokenId | span.attributes["iarsma.agent_token_id"] |

span.kind: "CHAIN" for commits, "TOOL" for reads/previews
