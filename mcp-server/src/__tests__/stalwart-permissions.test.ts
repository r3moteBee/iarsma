import { describe, expect, it } from 'vitest';
import { scopesToStalwartPermissions } from '../stalwart-permissions.js';

describe('scopesToStalwartPermissions', () => {
  // Baseline: base permissions always present regardless of scopes.
  it('always includes base permissions', () => {
    const perms = scopesToStalwartPermissions([]);
    expect(perms.authenticate).toBe(true);
    expect(perms.jmapCoreEcho).toBe(true);
  });

  // mail:mailbox — existing scope (regression guard)
  it('maps mail:mailbox to create/update/destroy mailbox permissions', () => {
    const perms = scopesToStalwartPermissions(['mail:mailbox']);
    expect(perms.jmapMailboxCreate).toBe(true);
    expect(perms.jmapMailboxUpdate).toBe(true);
    expect(perms.jmapMailboxDestroy).toBe(true);
    // should NOT grant email write
    expect(perms.jmapEmailUpdate).toBeUndefined();
  });

  // mail:label:read — Task 6
  it('maps mail:label:read to exactly jmapFileNodeGet + jmapBlobGet', () => {
    const perms = scopesToStalwartPermissions(['mail:label:read']);
    expect(perms.jmapFileNodeGet).toBe(true);
    expect(perms.jmapBlobGet).toBe(true);
    // write perms must NOT be present
    expect(perms.jmapFileNodeCreate).toBeUndefined();
    expect(perms.jmapFileNodeUpdate).toBeUndefined();
    expect(perms.jmapBlobUpload).toBeUndefined();
    // email-modify not granted here (comes from mail:modify)
    expect(perms.jmapEmailUpdate).toBeUndefined();
  });

  // mail:label:write — Task 6
  it('maps mail:label:write to jmapFileNodeGet + jmapFileNodeCreate + jmapFileNodeUpdate + jmapBlobUpload + jmapBlobGet', () => {
    const perms = scopesToStalwartPermissions(['mail:label:write']);
    expect(perms.jmapFileNodeGet).toBe(true);
    expect(perms.jmapFileNodeCreate).toBe(true);
    expect(perms.jmapFileNodeUpdate).toBe(true);
    expect(perms.jmapBlobUpload).toBe(true);
    expect(perms.jmapBlobGet).toBe(true);
    // destroy must NOT be present (labels are never destroyed)
    expect(perms.jmapFileNodeDestroy).toBeUndefined();
    // email update not included here
    expect(perms.jmapEmailUpdate).toBeUndefined();
  });

  // Combined: write is a superset of read
  it('mail:label:write grants all read permissions plus create/update/upload', () => {
    const readPerms = scopesToStalwartPermissions(['mail:label:read']);
    const writePerms = scopesToStalwartPermissions(['mail:label:write']);
    // Every FileNode/Blob perm in read must also be in write
    for (const [key, val] of Object.entries(readPerms)) {
      if (key.startsWith('jmapFileNode') || key.startsWith('jmapBlob')) {
        expect(writePerms[key]).toBe(val);
      }
    }
  });

  // Combining label:read + mail:modify does NOT double-add email update
  it('combining mail:label:read + mail:modify yields jmapEmailUpdate exactly once', () => {
    const perms = scopesToStalwartPermissions(['mail:label:read', 'mail:modify']);
    expect(perms.jmapEmailUpdate).toBe(true);
    expect(perms.jmapFileNodeGet).toBe(true);
  });
});
