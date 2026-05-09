import { describe, expect, it } from 'vitest';
import {
  createActionLog,
  inMemoryActionLogStore,
  webCryptoSha384,
  type Sha384,
  type StoredEntry,
} from '../action-log.js';

const ALICE = { id: 'alice@example.net' };

/** Predictable hash for assertions: sequence + first 32 bytes of input. */
function fakeSha384(): Sha384 {
  return async (bytes) => {
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i]!.toString(16).padStart(2, '0');
    }
    return `fake:${hex.length}:${hex.slice(0, 32)}`;
  };
}

describe('createActionLog.append', () => {
  it('records a genesis entry with empty prevHashHex and seq=0', async () => {
    const store = inMemoryActionLogStore();
    const log = createActionLog({ store, sha384: fakeSha384(), now: () => 1700000000000 });
    const entry = await log.append({
      identity: ALICE, callerClass: 'ui',
      action: 'session.get',
      params: {},
    });
    expect(entry.seq).toBe(0);
    expect(entry.prevHashHex).toBe('');
    expect(entry.data.identity).toBe(ALICE.id);
    expect(entry.data.action).toBe('session.get');
    expect(entry.hashHex).toMatch(/^fake:/);
    expect(await store.count()).toBe(1);
  });

  it('chains: each entry.prevHashHex matches the prior entry.hashHex', async () => {
    const store = inMemoryActionLogStore();
    const log = createActionLog({ store, sha384: fakeSha384(), now: () => 1 });
    const a = await log.append({ identity: ALICE, callerClass: 'ui', action: 'a', params: {} });
    const b = await log.append({ identity: ALICE, callerClass: 'ui', action: 'b', params: {} });
    const c = await log.append({ identity: ALICE, callerClass: 'ui', action: 'c', params: {} });
    expect(a.seq).toBe(0);
    expect(b.seq).toBe(1);
    expect(c.seq).toBe(2);
    expect(b.prevHashHex).toBe(a.hashHex);
    expect(c.prevHashHex).toBe(b.hashHex);
  });

  it('stamps schemaVersion=1 and the requested callerClass on every entry (D-047)', async () => {
    const store = inMemoryActionLogStore();
    const log = createActionLog({ store, sha384: fakeSha384(), now: () => 1 });
    const ui = await log.append({ identity: ALICE, callerClass: 'ui', action: 'session.get', params: {} });
    const mcp = await log.append({ identity: ALICE, callerClass: 'mcp', action: 'session.get', params: {} });
    const lib = await log.append({ identity: ALICE, callerClass: 'library', action: 'session.get', params: {} });
    expect(ui.data.schemaVersion).toBe(1);
    expect(ui.data.callerClass).toBe('ui');
    expect(mcp.data.callerClass).toBe('mcp');
    expect(lib.data.callerClass).toBe('library');
  });

  it("records mode and provenance on a destructive commit (D-046, D-047)", async () => {
    const store = inMemoryActionLogStore();
    const log = createActionLog({ store, sha384: fakeSha384(), now: () => 1 });
    const entry = await log.append({
      identity: ALICE,
      callerClass: 'mcp',
      action: 'mail.send',
      mode: 'commit',
      params: { to: ['bob@example.net'], subject: 'hi' },
      provenance: {
        affectedJson: JSON.stringify([{ kind: 'mail', id: 'M-7', op: 'create' }]),
        previewHashHex: 'abc123',
      },
    });
    expect(entry.data.mode).toBe('commit');
    expect(entry.data.provenance).toEqual({
      affectedJson: '[{"kind":"mail","id":"M-7","op":"create"}]',
      previewHashHex: 'abc123',
    });
  });

  it('omits mode and provenance on non-destructive reads', async () => {
    const store = inMemoryActionLogStore();
    const log = createActionLog({ store, sha384: fakeSha384(), now: () => 1 });
    const entry = await log.append({ identity: ALICE, callerClass: 'ui', action: 'session.get', params: {} });
    expect(entry.data.mode).toBeUndefined();
    expect(entry.data.provenance).toBeUndefined();
  });

  it('JSON-stringifies non-string params; pre-serialized strings pass through', async () => {
    const store = inMemoryActionLogStore();
    const log = createActionLog({ store, sha384: fakeSha384(), now: () => 1 });
    await log.append({ identity: ALICE, callerClass: 'ui', action: 'a', params: { x: 1 } });
    await log.append({ identity: ALICE, callerClass: 'ui', action: 'b', params: '{"y":2}' });
    const entries = await store.all();
    expect(entries[0]!.data.paramsJson).toBe('{"x":1}');
    expect(entries[1]!.data.paramsJson).toBe('{"y":2}');
  });

  it('uses Web Crypto SHA-384 by default and produces hex digests of length 96', async () => {
    const store = inMemoryActionLogStore();
    const log = createActionLog({ store, sha384: webCryptoSha384, now: () => 1 });
    const entry = await log.append({
      identity: ALICE, callerClass: 'ui',
      action: 'session.get',
      params: {},
    });
    expect(entry.hashHex).toMatch(/^[0-9a-f]{96}$/);
  });
});

describe('createActionLog.verify', () => {
  it('returns null on a clean chain', async () => {
    const store = inMemoryActionLogStore();
    const log = createActionLog({ store, sha384: fakeSha384(), now: () => 1 });
    await log.append({ identity: ALICE, callerClass: 'ui', action: 'a', params: {} });
    await log.append({ identity: ALICE, callerClass: 'ui', action: 'b', params: {} });
    expect(await log.verify()).toBeNull();
  });

  it('detects a broken link (tampered prevHashHex)', async () => {
    const store = inMemoryActionLogStore();
    const log = createActionLog({ store, sha384: fakeSha384(), now: () => 1 });
    await log.append({ identity: ALICE, callerClass: 'ui', action: 'a', params: {} });
    await log.append({ identity: ALICE, callerClass: 'ui', action: 'b', params: {} });

    // Splice a tampered entry into the store.
    const all = await store.all();
    const tampered: StoredEntry = { ...all[1]!, prevHashHex: 'WRONG' };
    const tamperedStore = inMemoryActionLogStore();
    await tamperedStore.append(all[0]!);
    await tamperedStore.append(tampered);

    const tlog = createActionLog({ store: tamperedStore, sha384: fakeSha384(), now: () => 1 });
    const err = await tlog.verify();
    expect(err).not.toBeNull();
    expect(err!.seq).toBe(1);
    expect(err!.message).toMatch(/broken link/);
  });

  it('detects payload tampering via hash recomputation', async () => {
    const store = inMemoryActionLogStore();
    const log = createActionLog({ store, sha384: fakeSha384(), now: () => 1 });
    await log.append({ identity: ALICE, callerClass: 'ui', action: 'a', params: {} });
    const all = await store.all();

    // Mutate `action` after the fact — link integrity still holds, but
    // the recomputed hash diverges from `hashHex`.
    const mutated: StoredEntry = {
      ...all[0]!,
      data: { ...all[0]!.data, action: 'mutated' },
    };
    const mutatedStore = inMemoryActionLogStore();
    await mutatedStore.append(mutated);

    const mlog = createActionLog({ store: mutatedStore, sha384: fakeSha384(), now: () => 1 });
    const err = await mlog.verify();
    expect(err).not.toBeNull();
    expect(err!.seq).toBe(0);
    expect(err!.message).toMatch(/hash mismatch/);
  });

  it('detects a missing entry (seq skip)', async () => {
    // Build a chain of three entries via the real append path, then
    // assemble a corrupt view that drops the middle entry — same chain
    // genealogy, but seq jumps 0 → 2.
    const real = inMemoryActionLogStore();
    const seedLog = createActionLog({ store: real, sha384: fakeSha384(), now: () => 1 });
    await seedLog.append({ identity: ALICE, callerClass: 'ui', action: 'a', params: {} });
    await seedLog.append({ identity: ALICE, callerClass: 'ui', action: 'b', params: {} });
    await seedLog.append({ identity: ALICE, callerClass: 'ui', action: 'c', params: {} });
    const all = await real.all();

    const corruptEntries: StoredEntry[] = [all[0]!, all[2]!];
    const corruptStore = {
      count: async () => corruptEntries.length,
      last: async () => corruptEntries[corruptEntries.length - 1] ?? null,
      all: async () => corruptEntries.slice(),
      append: async () => {
        throw new Error('read-only');
      },
    };

    const clog = createActionLog({ store: corruptStore, sha384: fakeSha384(), now: () => 1 });
    const err = await clog.verify();
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/out-of-order|broken link/);
  });
});

describe('inMemoryActionLogStore', () => {
  it('starts empty', async () => {
    const store = inMemoryActionLogStore();
    expect(await store.count()).toBe(0);
    expect(await store.last()).toBeNull();
    expect(await store.all()).toEqual([]);
  });

  it('rejects out-of-order seqs', async () => {
    const store = inMemoryActionLogStore();
    await expect(
      store.append({
        seq: 5,
        data: {
          schemaVersion: 1,
          timestampMs: 1,
          callerClass: 'ui',
          identity: 'x',
          action: 'a',
          paramsJson: '{}',
        },
        prevHashHex: '',
        hashHex: 'h',
      }),
    ).rejects.toThrow(/expected seq 0/);
  });
});
