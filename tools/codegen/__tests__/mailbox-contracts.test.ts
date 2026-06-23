import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// The codegen converts dots to dashes for filenames (safeName in run.ts).
// mailbox.delete → mailbox-delete.json
const del = readFileSync(new URL('../dist/tools/mailbox-delete.json', import.meta.url), 'utf8');

describe('mailbox.delete MCP tool doc', () => {
  it('documents safe-delete + refusal codes for agents', () => {
    expect(del).toContain('Trash');
    for (const code of ['mailbox_has_children', 'mailbox_protected', 'mailbox_forbidden', 'trash_not_found']) {
      expect(del).toContain(code);
    }
  });
});
