/**
 * Markdown docs generator tests (D-037).
 *
 * Implements F-3 test category 1 (snapshot) for the markdown generator.
 * Renders deterministic output that downstream sites can consume.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { capability } from '../contract.js';
import {
  llmsTxtForCapabilities,
  markdownForCapability,
  markdownIndexForCapabilities,
  typeNodeToInlineMarkdown,
} from '../generators/markdown.js';

const send = capability({
  name: 'mail.send',
  scopes: ['mail:send'],
  description: 'Send an email through the configured outbound relay.',
  isDestructive: true,
  input: z.object({
    to: z.array(z.string()).describe('Recipient addresses.'),
    subject: z.string(),
    body: z.string().optional(),
  }),
  output: z.object({
    messageId: z.string(),
  }),
  examples: [
    {
      title: 'Send a plain text message',
      input: { to: ['alice@example.com'], subject: 'Hi', body: 'Hello.' },
      output: { messageId: 'M-1' },
    },
  ],
});

const sessionGet = capability({
  name: 'session.get',
  scopes: ['session:read'],
  description: 'Get the current session.',
  input: z.object({}),
  output: z.object({ username: z.string() }),
  examples: [],
});

// ──────────────────────────────────────────────────────────────────────────
// typeNodeToInlineMarkdown — TypeNode → inline type expression
// ──────────────────────────────────────────────────────────────────────────

describe('typeNodeToInlineMarkdown', () => {
  it('renders primitives', () => {
    expect(typeNodeToInlineMarkdown({ kind: 'string' })).toBe('string');
    expect(typeNodeToInlineMarkdown({ kind: 'number', integer: false })).toBe('number');
    expect(typeNodeToInlineMarkdown({ kind: 'number', integer: true })).toBe('integer');
    expect(typeNodeToInlineMarkdown({ kind: 'boolean' })).toBe('boolean');
    expect(typeNodeToInlineMarkdown({ kind: 'unit' })).toBe('void');
  });

  it('renders option, list, enum', () => {
    expect(
      typeNodeToInlineMarkdown({ kind: 'option', inner: { kind: 'string' } }),
    ).toBe('string | null');
    expect(
      typeNodeToInlineMarkdown({ kind: 'list', element: { kind: 'string' } }),
    ).toBe('Array<string>');
    expect(typeNodeToInlineMarkdown({ kind: 'enum', values: ['a', 'b'] })).toBe(
      "'a' | 'b'",
    );
  });

  it('renders inline records and variants', () => {
    expect(
      typeNodeToInlineMarkdown({
        kind: 'record',
        fields: [
          { name: 'a', type: { kind: 'string' }, optional: false },
          { name: 'b', type: { kind: 'number', integer: true }, optional: true },
        ],
      }),
    ).toBe('{ a: string; b?: integer }');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// markdownForCapability — full page
// ──────────────────────────────────────────────────────────────────────────

describe('markdownForCapability', () => {
  it('renders heading + description + scopes + destructive flag', () => {
    const md = markdownForCapability(send.ast);
    expect(md).toContain('# `mail.send`');
    expect(md).toContain('Send an email through the configured outbound relay.');
    expect(md).toContain('**Scopes:** `mail:send`');
    expect(md).toContain('**Destructive:** yes (requires dry-run)');
  });

  it('marks non-destructive capabilities clearly', () => {
    const md = markdownForCapability(sessionGet.ast);
    expect(md).toContain('**Destructive:** no');
  });

  it('renders input table with required + descriptions', () => {
    const md = markdownForCapability(send.ast);
    expect(md).toMatch(/\| Field \| Type \| Required \| Description \|/);
    expect(md).toMatch(/\| `to` \| `Array<string>` \| ✓ \| Recipient addresses\. \|/);
    // body is optional → no checkmark in Required column.
    // body's type is option<string>, which renders as `string | null`.
    // The pipe inside the type cell is escaped (`\|`) so the table column
    // boundary isn't broken.
    expect(md).toContain('`body`');
    expect(md).toContain('`string \\| null`');
  });

  it('escapes pipe characters inside table cells (no broken columns)', () => {
    const md = markdownForCapability(send.ast);
    // Each row of the input/output tables must have exactly 5 unescaped
    // pipes (4 column boundaries + 1 trailing). Walk the table lines and
    // verify the body row counts correctly.
    const bodyLine = md.split('\n').find((l) => l.includes('`body`'));
    expect(bodyLine).toBeDefined();
    // Strip escaped pipes (\|) before counting unescaped ones.
    const unescapedPipes = bodyLine!.replace(/\\\|/g, '').match(/\|/g) ?? [];
    expect(unescapedPipes.length).toBe(5);
  });

  it('renders empty-record inputs as "(no fields)"', () => {
    const md = markdownForCapability(sessionGet.ast);
    expect(md).toContain('## Input');
    expect(md).toContain('_(no fields)_');
  });

  it('renders examples as JSON code blocks', () => {
    const md = markdownForCapability(send.ast);
    expect(md).toContain('### Send a plain text message');
    expect(md).toContain('**Input:**');
    expect(md).toContain('"to": [');
    expect(md).toContain('"alice@example.com"');
  });

  it('omits the Examples section when there are none', () => {
    const md = markdownForCapability(sessionGet.ast);
    expect(md).not.toContain('## Examples');
  });

  it('output ends with a single trailing newline', () => {
    const md = markdownForCapability(send.ast);
    expect(md.endsWith('\n')).toBe(true);
    expect(md.endsWith('\n\n')).toBe(false);
  });

  it('is deterministic — same input produces byte-identical output', () => {
    const a = markdownForCapability(send.ast);
    const b = markdownForCapability(send.ast);
    expect(a).toBe(b);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// markdownIndexForCapabilities
// ──────────────────────────────────────────────────────────────────────────

describe('markdownIndexForCapabilities', () => {
  it('groups capabilities by tag (first dot-segment)', () => {
    const md = markdownIndexForCapabilities([send.ast, sessionGet.ast]);
    expect(md).toContain('## mail');
    expect(md).toContain('## session');
  });

  it('lists capabilities with markdown links to their pages', () => {
    const md = markdownIndexForCapabilities([send.ast, sessionGet.ast]);
    expect(md).toContain('[`mail.send`](./mail-send.md)');
    expect(md).toContain('[`session.get`](./session-get.md)');
  });

  it('annotates destructive capabilities', () => {
    const md = markdownIndexForCapabilities([send.ast]);
    expect(md).toContain('_(destructive)_');
  });

  it('sorts capabilities deterministically', () => {
    const a = markdownIndexForCapabilities([send.ast, sessionGet.ast]);
    const b = markdownIndexForCapabilities([sessionGet.ast, send.ast]);
    expect(a).toBe(b);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// llmsTxtForCapabilities
// ──────────────────────────────────────────────────────────────────────────

describe('llmsTxtForCapabilities', () => {
  it('starts with the project headline and pitch', () => {
    const txt = llmsTxtForCapabilities([send.ast, sessionGet.ast]);
    expect(txt).toMatch(/^# Iarsma\n/);
    expect(txt).toContain('agents can be colleagues without chaos');
  });

  it('mentions the discovery URN', () => {
    const txt = llmsTxtForCapabilities([send.ast, sessionGet.ast]);
    expect(txt).toContain('urn:iarsma:agent-context');
  });

  it('lists capabilities under "## Capabilities" heading', () => {
    const txt = llmsTxtForCapabilities([send.ast, sessionGet.ast]);
    expect(txt).toContain('## Capabilities');
    expect(txt).toContain('`mail.send`');
    expect(txt).toContain('`session.get`');
  });

  it('uses absolute URLs when siteUrl is provided', () => {
    const txt = llmsTxtForCapabilities([sessionGet.ast], { siteUrl: 'https://iarsma.io/docs' });
    expect(txt).toContain('https://iarsma.io/docs/session-get.md');
    expect(txt).toContain('https://iarsma.io/docs/openapi.json');
  });

  it('uses relative URLs by default', () => {
    const txt = llmsTxtForCapabilities([sessionGet.ast]);
    expect(txt).toContain('./session-get.md');
    expect(txt).toContain('./openapi.json');
  });
});
