import { describe, expect, it } from 'vitest';
import { exportToOpenInference } from '../openinference-export.js';
import type { StoredEntry } from '../action-log.js';

// ── Fixtures ─────────────────────────────────────────────────────────

function readEntry(overrides?: Partial<StoredEntry>): StoredEntry {
  return {
    seq: 0,
    data: {
      schemaVersion: 1,
      timestampMs: 1700000000000,
      callerClass: 'ui',
      identity: 'alice@example.net',
      action: 'mail.get',
      paramsJson: '{"mailboxId":"INBOX"}',
    },
    prevHashHex: '',
    hashHex: 'aaaa',
    ...overrides,
  };
}

function commitEntry(overrides?: Partial<StoredEntry>): StoredEntry {
  return {
    seq: 1,
    data: {
      schemaVersion: 1,
      timestampMs: 1700000001000,
      callerClass: 'mcp',
      identity: 'bob@example.net',
      action: 'mail.send',
      mode: 'commit',
      paramsJson: '{"to":["carol@example.net"]}',
      provenance: {
        affectedJson: JSON.stringify([{ kind: 'mail', id: 'M-7', op: 'create' }]),
        previewHashHex: 'prevhash123',
      },
    },
    prevHashHex: 'aaaa',
    hashHex: 'bbbb',
    ...overrides,
  };
}

function previewEntry(overrides?: Partial<StoredEntry>): StoredEntry {
  return {
    seq: 2,
    data: {
      schemaVersion: 1,
      timestampMs: 1700000002000,
      callerClass: 'mcp',
      identity: 'bob@example.net',
      action: 'mail.send',
      mode: 'preview',
      paramsJson: '{"to":["carol@example.net"]}',
    },
    prevHashHex: 'bbbb',
    hashHex: 'cccc',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('exportToOpenInference', () => {
  it('maps a read entry (no mode) to span_kind TOOL', () => {
    const [span] = exportToOpenInference([readEntry()]);
    expect(span!.span_kind).toBe('TOOL');
  });

  it('maps a commit entry to span_kind CHAIN', () => {
    const [span] = exportToOpenInference([commitEntry()]);
    expect(span!.span_kind).toBe('CHAIN');
  });

  it('maps a preview entry to span_kind TOOL', () => {
    const [span] = exportToOpenInference([previewEntry()]);
    expect(span!.span_kind).toBe('TOOL');
  });

  it('start_time is ISO 8601', () => {
    const [span] = exportToOpenInference([readEntry()]);
    // 1700000000000 → 2023-11-14T22:13:20.000Z
    expect(span!.start_time).toBe('2023-11-14T22:13:20.000Z');
  });

  it('includes iarsma.hash_hex and iarsma.prev_hash_hex', () => {
    const [span] = exportToOpenInference([commitEntry()]);
    expect(span!.attributes['iarsma.hash_hex']).toBe('bbbb');
    expect(span!.attributes['iarsma.prev_hash_hex']).toBe('aaaa');
  });

  it('includes provenance fields when present', () => {
    const [span] = exportToOpenInference([commitEntry()]);
    expect(span!.attributes['iarsma.preview_hash_hex']).toBe('prevhash123');
    expect(span!.output).toEqual({
      value: JSON.stringify([{ kind: 'mail', id: 'M-7', op: 'create' }]),
    });
  });

  it('omits provenance fields when absent', () => {
    const [span] = exportToOpenInference([readEntry()]);
    expect(span!.attributes['iarsma.preview_hash_hex']).toBeUndefined();
    expect(span!.output).toBeUndefined();
  });

  it('input.value contains the paramsJson', () => {
    const [span] = exportToOpenInference([readEntry()]);
    expect(span!.input).toEqual({ value: '{"mailboxId":"INBOX"}' });
  });

  it('output.value contains affectedJson for commits', () => {
    const [span] = exportToOpenInference([commitEntry()]);
    expect(span!.output!.value).toBe(
      JSON.stringify([{ kind: 'mail', id: 'M-7', op: 'create' }]),
    );
  });

  it('maps multiple entries preserving order', () => {
    const entries = [readEntry(), commitEntry(), previewEntry()];
    const spans = exportToOpenInference(entries);
    expect(spans).toHaveLength(3);
    expect(spans[0]!.name).toBe('mail.get');
    expect(spans[1]!.name).toBe('mail.send');
    expect(spans[2]!.name).toBe('mail.send');
    expect(spans[0]!.span_kind).toBe('TOOL');
    expect(spans[1]!.span_kind).toBe('CHAIN');
    expect(spans[2]!.span_kind).toBe('TOOL');
  });

  it('includes agentTokenId when present', () => {
    const entry = commitEntry({
      data: {
        ...commitEntry().data,
        callerClass: 'agent',
        agentTokenId: 'tok_abc123',
      },
    });
    const [span] = exportToOpenInference([entry]);
    expect(span!.attributes['iarsma.agent_token_id']).toBe('tok_abc123');
  });

  it('omits agentTokenId attribute when not present', () => {
    const [span] = exportToOpenInference([readEntry()]);
    expect(span!.attributes['iarsma.agent_token_id']).toBeUndefined();
  });

  it('omits mode attribute when not set on a read entry', () => {
    const [span] = exportToOpenInference([readEntry()]);
    expect(span!.attributes['mode']).toBeUndefined();
  });

  it('includes mode attribute when set', () => {
    const [span] = exportToOpenInference([commitEntry()]);
    expect(span!.attributes['mode']).toBe('commit');
  });

  it('sets span name to the action field', () => {
    const [span] = exportToOpenInference([readEntry()]);
    expect(span!.name).toBe('mail.get');
  });

  it('sets caller_class and identity in attributes', () => {
    const [span] = exportToOpenInference([readEntry()]);
    expect(span!.attributes['caller_class']).toBe('ui');
    expect(span!.attributes['identity']).toBe('alice@example.net');
  });

  it('sets iarsma.schema_version in attributes', () => {
    const [span] = exportToOpenInference([readEntry()]);
    expect(span!.attributes['iarsma.schema_version']).toBe(1);
  });
});
