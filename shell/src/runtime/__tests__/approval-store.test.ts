/**
 * Tests for the Approval Store (Phase 3b — approval queue).
 *
 * Covers the in-memory implementation used for unit tests.
 * The JMAP-backed implementation shares the same interface and
 * is integration-tested against a live Stalwart instance separately.
 */

import { describe, expect, it } from 'vitest';
import {
  inMemoryApprovalStore,
  type CreateApprovalInput,
} from '../approval-store.js';

const sampleInput: CreateApprovalInput = {
  schemaVersion: 1,
  toolName: 'mail.send',
  requestingAgentId: 'agent-1',
  requestingAgentName: 'Test Agent',
  params: { to: 'alice@example.com', subject: 'Hello' },
  preview: { effects: ['Email/set', 'EmailSubmission/set'] },
  previewHashHex: 'abc123',
  requestedAt: '2026-05-24T00:00:00Z',
};

describe('inMemoryApprovalStore', () => {
  it('ensureMailbox returns a string ID', async () => {
    const store = inMemoryApprovalStore();
    const id = await store.ensureMailbox();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('ensureMailbox returns the same ID on subsequent calls', async () => {
    const store = inMemoryApprovalStore();
    const id1 = await store.ensureMailbox();
    const id2 = await store.ensureMailbox();
    expect(id1).toBe(id2);
  });

  it('create returns a string ID', async () => {
    const store = inMemoryApprovalStore();
    const id = await store.create(sampleInput);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('create → list returns the approval with status "pending"', async () => {
    const store = inMemoryApprovalStore();
    const id = await store.create(sampleInput);
    const items = await store.list();
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.id).toBe(id);
    expect(item.status).toBe('pending');
    expect(item.toolName).toBe('mail.send');
    expect(item.requestingAgentId).toBe('agent-1');
    expect(item.requestingAgentName).toBe('Test Agent');
    expect(item.params).toEqual(sampleInput.params);
    expect(item.preview).toEqual(sampleInput.preview);
    expect(item.previewHashHex).toBe('abc123');
    expect(item.requestedAt).toBe('2026-05-24T00:00:00Z');
    expect(item.schemaVersion).toBe(1);
  });

  it('approve → list shows "approved"', async () => {
    const store = inMemoryApprovalStore();
    const id = await store.create(sampleInput);
    await store.approve(id);
    const items = await store.list();
    expect(items).toHaveLength(1);
    expect(items[0]!.status).toBe('approved');
  });

  it('deny → list shows "denied"', async () => {
    const store = inMemoryApprovalStore();
    const id = await store.create(sampleInput);
    await store.deny(id);
    const items = await store.list();
    expect(items).toHaveLength(1);
    expect(items[0]!.status).toBe('denied');
  });

  it('get returns the correct approval', async () => {
    const store = inMemoryApprovalStore();
    const id = await store.create(sampleInput);
    const item = await store.get(id);
    expect(item).not.toBeNull();
    expect(item!.id).toBe(id);
    expect(item!.toolName).toBe('mail.send');
    expect(item!.status).toBe('pending');
  });

  it('get returns null for unknown ID', async () => {
    const store = inMemoryApprovalStore();
    const item = await store.get('nonexistent-id');
    expect(item).toBeNull();
  });

  it('list with status filter returns only matching items', async () => {
    const store = inMemoryApprovalStore();
    const id1 = await store.create({ ...sampleInput, toolName: 'mail.send' });
    const id2 = await store.create({ ...sampleInput, toolName: 'mail.draft' });
    const id3 = await store.create({ ...sampleInput, toolName: 'mail.delete' });

    await store.approve(id1);
    await store.deny(id2);
    // id3 stays pending

    const pending = await store.list({ status: 'pending' });
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).toBe(id3);

    const approved = await store.list({ status: 'approved' });
    expect(approved).toHaveLength(1);
    expect(approved[0]!.id).toBe(id1);

    const denied = await store.list({ status: 'denied' });
    expect(denied).toHaveLength(1);
    expect(denied[0]!.id).toBe(id2);
  });

  it('list without filter returns all items', async () => {
    const store = inMemoryApprovalStore();
    await store.create(sampleInput);
    await store.create({ ...sampleInput, toolName: 'mail.draft' });
    const items = await store.list();
    expect(items).toHaveLength(2);
  });

  it('approve throws for unknown ID', async () => {
    const store = inMemoryApprovalStore();
    await expect(store.approve('bad-id')).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('deny throws for unknown ID', async () => {
    const store = inMemoryApprovalStore();
    await expect(store.deny('bad-id')).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
