/**
 * Tests for the keyboard-bindings registry (Phase 1 work item 10).
 *
 * Schema lock so a future binding addition forces a doc update + test
 * update, not a silent drift between code and `docs/keyboard.md`.
 */

import { describe, expect, it } from 'vitest';
import {
  KEYBOARD_BINDINGS,
  SCOPE_LABELS,
  bindingsByScope,
} from '../keyboard-bindings.js';

describe('KEYBOARD_BINDINGS', () => {
  it('declares the binding set with the expected counts per scope', () => {
    const grouped = bindingsByScope();
    // Phase 1 + Phase 2 item 5: global gains `c`, thread-view gains
    // `r` + `R`.
    expect(grouped.get('global')?.length).toBe(3);
    expect(grouped.get('mailbox-sidebar')?.length).toBe(7);
    expect(grouped.get('thread-list')?.length).toBe(5);
    expect(grouped.get('thread-view')?.length).toBe(5);
  });

  it('every binding has a non-empty keys + action label', () => {
    for (const b of KEYBOARD_BINDINGS) {
      expect(b.keys).not.toBe('');
      expect(b.action).not.toBe('');
    }
  });

  it('declares the question-mark binding (anchor for the help overlay)', () => {
    const helpBinding = KEYBOARD_BINDINGS.find(
      (b) => b.keys === '?' && b.scope === 'global',
    );
    expect(helpBinding).toBeDefined();
    expect(helpBinding?.action.toLowerCase()).toContain('keyboard help');
  });

  it('bindingsByScope preserves insertion order', () => {
    const grouped = bindingsByScope();
    const firstThreadList = grouped.get('thread-list')?.[0];
    expect(firstThreadList?.keys).toBe('j / ↓');
  });

  it('every declared scope has a human-readable label', () => {
    for (const scope of bindingsByScope().keys()) {
      expect(SCOPE_LABELS[scope]).toBeDefined();
      expect(SCOPE_LABELS[scope]).not.toBe('');
    }
  });
});
