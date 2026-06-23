/**
 * Content tests for the label.* capability contracts.
 *
 * These are "content tests" (D-035 category 2): they assert the human-readable
 * contract metadata that agents depend on — names, scopes, destructive flag,
 * refusal codes in descriptions, and dry-run preview shapes.
 *
 * Mirror of mailbox-contracts.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { labelList } from '../contracts/label-list.js';
import { labelCreate } from '../contracts/label-create.js';
import { labelUpdate } from '../contracts/label-update.js';
import { labelDelete } from '../contracts/label-delete.js';
import { labelApply } from '../contracts/label-apply.js';

// ─────────────────────────────────────────────────────────────────────────────
// label.list
// ─────────────────────────────────────────────────────────────────────────────

describe('label.list', () => {
  it('has the correct name', () => {
    expect(labelList.ast.name).toBe('label.list');
  });

  it('requires mail:label:read scope', () => {
    expect(labelList.ast.scopes).toEqual(['mail:label:read']);
  });

  it('is not destructive', () => {
    expect(labelList.ast.isDestructive).toBe(false);
  });

  it('has no dryRun.preview (non-destructive)', () => {
    expect(labelList.ast.dryRun).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// label.create
// ─────────────────────────────────────────────────────────────────────────────

describe('label.create', () => {
  it('has the correct name', () => {
    expect(labelCreate.ast.name).toBe('label.create');
  });

  it('requires mail:label:write scope', () => {
    expect(labelCreate.ast.scopes).toEqual(['mail:label:write']);
  });

  it('is not destructive', () => {
    expect(labelCreate.ast.isDestructive).toBe(false);
  });

  it('description names label_name_invalid refusal code', () => {
    expect(labelCreate.ast.description).toContain('label_name_invalid');
  });

  it('description names label_key_conflict refusal code', () => {
    expect(labelCreate.ast.description).toContain('label_key_conflict');
  });

  it('description names label_limit_reached refusal code', () => {
    expect(labelCreate.ast.description).toContain('label_limit_reached');
  });

  it('description names label_registry_conflict refusal code', () => {
    expect(labelCreate.ast.description).toContain('label_registry_conflict');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// label.update
// ─────────────────────────────────────────────────────────────────────────────

describe('label.update', () => {
  it('has the correct name', () => {
    expect(labelUpdate.ast.name).toBe('label.update');
  });

  it('requires mail:label:write scope', () => {
    expect(labelUpdate.ast.scopes).toEqual(['mail:label:write']);
  });

  it('is not destructive', () => {
    expect(labelUpdate.ast.isDestructive).toBe(false);
  });

  it('description names label_not_found refusal code', () => {
    expect(labelUpdate.ast.description).toContain('label_not_found');
  });

  it('description names label_registry_conflict refusal code', () => {
    expect(labelUpdate.ast.description).toContain('label_registry_conflict');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// label.delete
// ─────────────────────────────────────────────────────────────────────────────

describe('label.delete', () => {
  it('has the correct name', () => {
    expect(labelDelete.ast.name).toBe('label.delete');
  });

  it('requires mail:label:write scope', () => {
    expect(labelDelete.ast.scopes).toEqual(['mail:label:write']);
  });

  it('is destructive', () => {
    expect(labelDelete.ast.isDestructive).toBe(true);
  });

  it('declares dryRun.preview with affectedCount', () => {
    expect(labelDelete.ast.dryRun).toBeDefined();
    // dryRun.preview is a TypeNode (kind:'record'), not a JSON Schema object.
    expect(labelDelete.ast.dryRun!.preview).toMatchObject({ kind: 'record' });
    const previewStr = JSON.stringify(labelDelete.ast.dryRun!.preview);
    expect(previewStr).toContain('affectedCount');
  });

  it('description names label_not_found refusal code', () => {
    expect(labelDelete.ast.description).toContain('label_not_found');
  });

  it('description names label_untag_failed refusal code', () => {
    expect(labelDelete.ast.description).toContain('label_untag_failed');
  });

  it('errors array includes label_untag_failed', () => {
    const codes = labelDelete.ast.errors?.map((e) => e.code) ?? [];
    expect(codes).toContain('label_untag_failed');
  });

  it('description names label_registry_conflict refusal code', () => {
    expect(labelDelete.ast.description).toContain('label_registry_conflict');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// label.apply
// ─────────────────────────────────────────────────────────────────────────────

describe('label.apply', () => {
  it('has the correct name', () => {
    expect(labelApply.ast.name).toBe('label.apply');
  });

  it('requires mail:label:read and mail:modify scopes', () => {
    expect(labelApply.ast.scopes).toEqual(['mail:label:read', 'mail:modify']);
  });

  it('is destructive', () => {
    expect(labelApply.ast.isDestructive).toBe(true);
  });

  it('declares dryRun.preview with affectedCount', () => {
    expect(labelApply.ast.dryRun).toBeDefined();
    // dryRun.preview is a TypeNode (kind:'record'), not a JSON Schema object.
    expect(labelApply.ast.dryRun!.preview).toMatchObject({ kind: 'record' });
    const previewStr = JSON.stringify(labelApply.ast.dryRun!.preview);
    expect(previewStr).toContain('affectedCount');
  });

  it('description names label_not_found refusal code', () => {
    expect(labelApply.ast.description).toContain('label_not_found');
  });

  it('description names email_not_found refusal code', () => {
    expect(labelApply.ast.description).toContain('email_not_found');
  });

  it('description states add/remove accept label names or keys', () => {
    expect(labelApply.ast.description).toMatch(/name|key/i);
  });
});
