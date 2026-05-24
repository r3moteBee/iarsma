/**
 * Tests for the AgentMetadataStore in-memory implementation.
 *
 * Coverage:
 *   - save + get round-trips a record
 *   - listAll returns all saved records
 *   - markRevoked sets revoked: true
 *   - get returns null for unknown tokenId
 *   - markRevoked is a no-op for unknown tokenId
 */

import { describe, expect, it } from 'vitest';
import {
  inMemoryAgentMetadataStore,
  type AgentMetadata,
} from '../agent-metadata-store.js';

/** Helper to create a valid AgentMetadata record with overrides. */
function makeRecord(overrides?: Partial<AgentMetadata>): AgentMetadata {
  return {
    tokenId: 'tok-001',
    name: 'test-agent',
    scopes: ['urn:ietf:params:jmap:mail'],
    issuedAt: '2025-01-15T10:00:00Z',
    expiresAt: '2025-01-15T11:00:00Z',
    revoked: false,
    issuanceLogEntryHash: 'sha384:abc123',
    ...overrides,
  };
}

describe('inMemoryAgentMetadataStore', () => {
  it('save + get round-trips a record', async () => {
    const store = inMemoryAgentMetadataStore();
    const record = makeRecord();

    await store.save(record);
    const retrieved = await store.get('tok-001');

    expect(retrieved).toEqual(record);
  });

  it('get returns null for unknown tokenId', async () => {
    const store = inMemoryAgentMetadataStore();

    const result = await store.get('nonexistent');

    expect(result).toBeNull();
  });

  it('listAll returns all saved records', async () => {
    const store = inMemoryAgentMetadataStore();
    const r1 = makeRecord({ tokenId: 'tok-001', name: 'agent-a' });
    const r2 = makeRecord({ tokenId: 'tok-002', name: 'agent-b' });
    const r3 = makeRecord({ tokenId: 'tok-003', name: 'agent-c' });

    await store.save(r1);
    await store.save(r2);
    await store.save(r3);

    const all = await store.listAll();
    expect(all).toHaveLength(3);
    expect(all).toContainEqual(r1);
    expect(all).toContainEqual(r2);
    expect(all).toContainEqual(r3);
  });

  it('listAll returns empty array when nothing saved', async () => {
    const store = inMemoryAgentMetadataStore();

    const all = await store.listAll();

    expect(all).toEqual([]);
  });

  it('markRevoked sets revoked: true', async () => {
    const store = inMemoryAgentMetadataStore();
    const record = makeRecord({ revoked: false });

    await store.save(record);
    await store.markRevoked('tok-001');

    const updated = await store.get('tok-001');
    expect(updated).not.toBeNull();
    expect(updated!.revoked).toBe(true);
    // All other fields remain unchanged.
    expect(updated!.tokenId).toBe(record.tokenId);
    expect(updated!.name).toBe(record.name);
    expect(updated!.scopes).toEqual(record.scopes);
    expect(updated!.issuedAt).toBe(record.issuedAt);
    expect(updated!.expiresAt).toBe(record.expiresAt);
    expect(updated!.issuanceLogEntryHash).toBe(record.issuanceLogEntryHash);
  });

  it('markRevoked is a no-op for unknown tokenId', async () => {
    const store = inMemoryAgentMetadataStore();
    const record = makeRecord();

    await store.save(record);

    // Should not throw.
    await store.markRevoked('nonexistent');

    // Existing record remains untouched.
    const existing = await store.get('tok-001');
    expect(existing).toEqual(record);
  });

  it('save overwrites an existing record with the same tokenId', async () => {
    const store = inMemoryAgentMetadataStore();
    const original = makeRecord({ name: 'original' });
    const updated = makeRecord({ name: 'updated' });

    await store.save(original);
    await store.save(updated);

    const result = await store.get('tok-001');
    expect(result!.name).toBe('updated');

    const all = await store.listAll();
    expect(all).toHaveLength(1);
  });
});
