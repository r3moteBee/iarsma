/**
 * @vitest-environment jsdom
 *
 * ComposerToolbar tests (PR 52 / CoWork #6).
 *
 * Covers:
 *   - pathToActive() pure-function correctness across the tag matrix
 *     (B/STRONG, I/EM, U, A, UL, OL, BLOCKQUOTE, PRE>CODE, CODE alone).
 *   - Rendering: disabled state when editor=null; enabled state when
 *     a fake Squire instance is supplied.
 *   - Button wiring: each button invokes the corresponding Squire
 *     method (mocked) and refocuses the editor.
 *   - Active-state visualization: aria-pressed reflects the path.
 *   - axe baseline.
 *
 * The "editor" used here is a hand-rolled stub that records calls. We
 * don't mount a real Squire because (a) Squire ties to a live DOM
 * mutation observer that's flaky under vitest; (b) the toolbar's
 * contract with Squire is purely "call these methods, read getPath()" —
 * a stub captures that contract precisely.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@iarsma/wasm-bindings/html-sanitizer', () => ({
  sanitize: { sanitize: (html: string) => html },
}));

import { runAxe } from '../../__tests__/util/axe.js';
import { ComposerToolbar, pathToActive } from '../composer-toolbar.js';

afterEach(() => {
  cleanup();
});

type Listener = (e: Event) => void;

/**
 * Minimal stub that satisfies the Squire-shaped API the toolbar uses.
 * Records every method call so the test can assert intent. The
 * `pathChange` event listener registry is exposed so tests can drive
 * the toolbar's active-state refresh.
 */
function makeStubEditor(initialPath = 'BODY>P') {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const listeners: Record<string, Listener[]> = {};
  let path = initialPath;
  const setPath = (next: string): void => {
    path = next;
  };
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
      return stub;
    };

  const stub = {
    getPath: () => path,
    hasFormat: (tag: string) => path.toUpperCase().split('>').includes(tag),
    addEventListener: (type: string, fn: Listener) => {
      (listeners[type] ??= []).push(fn);
      return stub;
    },
    removeEventListener: (type: string, fn: Listener) => {
      const arr = listeners[type] ?? [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
      return stub;
    },
    fire: (type: string): void => {
      for (const l of listeners[type] ?? []) l(new Event(type));
    },
    bold: record('bold'),
    removeBold: record('removeBold'),
    italic: record('italic'),
    removeItalic: record('removeItalic'),
    underline: record('underline'),
    removeUnderline: record('removeUnderline'),
    makeLink: record('makeLink'),
    removeLink: record('removeLink'),
    makeUnorderedList: record('makeUnorderedList'),
    makeOrderedList: record('makeOrderedList'),
    removeList: record('removeList'),
    changeFormat: record('changeFormat'),
    code: record('code'),
    removeCode: record('removeCode'),
    increaseQuoteLevel: record('increaseQuoteLevel'),
    decreaseQuoteLevel: record('decreaseQuoteLevel'),
    removeAllFormatting: record('removeAllFormatting'),
    focus: record('focus'),
    setPath,
    calls,
  };

  return stub;
}

describe('pathToActive — pure path-to-format-flags mapping', () => {
  it('detects bold via B and STRONG', () => {
    expect(pathToActive('BODY>P>B').bold).toBe(true);
    expect(pathToActive('BODY>P>STRONG').bold).toBe(true);
    expect(pathToActive('BODY>P').bold).toBe(false);
  });
  it('detects italic via I and EM', () => {
    expect(pathToActive('BODY>P>I').italic).toBe(true);
    expect(pathToActive('BODY>P>EM').italic).toBe(true);
  });
  it('detects underline via U', () => {
    expect(pathToActive('BODY>P>U').underline).toBe(true);
  });
  it('detects link via A', () => {
    expect(pathToActive('BODY>P>A').link).toBe(true);
  });
  it('detects bullet + numbered lists via UL / OL', () => {
    expect(pathToActive('BODY>UL>LI').ul).toBe(true);
    expect(pathToActive('BODY>UL>LI').ol).toBe(false);
    expect(pathToActive('BODY>OL>LI').ol).toBe(true);
    expect(pathToActive('BODY>OL>LI').ul).toBe(false);
  });
  it('detects blockquote via BLOCKQUOTE', () => {
    expect(pathToActive('BODY>BLOCKQUOTE>P').quote).toBe(true);
  });
  it('treats CODE inside PRE as codeBlock only — not inline', () => {
    const a = pathToActive('BODY>PRE>CODE');
    expect(a.codeBlock).toBe(true);
    expect(a.inlineCode).toBe(false);
  });
  it('treats bare CODE as inline only — not block', () => {
    const a = pathToActive('BODY>P>CODE');
    expect(a.inlineCode).toBe(true);
    expect(a.codeBlock).toBe(false);
  });
  it('is case-insensitive', () => {
    expect(pathToActive('body>p>strong').bold).toBe(true);
  });
});

describe('ComposerToolbar — rendering', () => {
  it('renders a toolbar with all ten buttons when editor is null', () => {
    render(<ComposerToolbar editor={null} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Message formatting' });
    expect(toolbar).toBeInTheDocument();
    // ten command buttons (bold, italic, underline, link, ul, ol,
    // inline code, code block, quote, clear)
    expect(toolbar.querySelectorAll('button')).toHaveLength(10);
  });

  it('disables every button when editor is null', () => {
    render(<ComposerToolbar editor={null} />);
    const buttons = screen.getAllByRole('button');
    for (const b of buttons) expect(b).toBeDisabled();
  });

  it('enables every button when editor is provided', () => {
    const stub = makeStubEditor();
    render(<ComposerToolbar editor={stub as never} />);
    const buttons = screen.getAllByRole('button');
    for (const b of buttons) expect(b).not.toBeDisabled();
  });
});

describe('ComposerToolbar — button wiring', () => {
  it('Bold button calls editor.bold() when not bold; removeBold() when bold', () => {
    const stub = makeStubEditor('BODY>P');
    const { rerender } = render(<ComposerToolbar editor={stub as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(stub.calls.map((c) => c.name)).toContain('bold');

    stub.setPath('BODY>P>B');
    act(() => stub.fire('pathChange'));
    rerender(<ComposerToolbar editor={stub as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(stub.calls.map((c) => c.name)).toContain('removeBold');
  });

  it('Link button prompts and calls makeLink with the entered URL', () => {
    const stub = makeStubEditor('BODY>P');
    vi.spyOn(window, 'prompt').mockReturnValue('https://example.com');
    render(<ComposerToolbar editor={stub as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Insert link' }));
    const linkCall = stub.calls.find((c) => c.name === 'makeLink');
    expect(linkCall?.args[0]).toBe('https://example.com');
  });

  it('Link button skips makeLink when the prompt is cancelled', () => {
    const stub = makeStubEditor('BODY>P');
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    render(<ComposerToolbar editor={stub as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Insert link' }));
    expect(stub.calls.some((c) => c.name === 'makeLink')).toBe(false);
  });

  it('Link button removes link when path is inside an A', () => {
    const stub = makeStubEditor('BODY>P>A');
    render(<ComposerToolbar editor={stub as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    expect(stub.calls.some((c) => c.name === 'removeLink')).toBe(true);
  });

  it('Bullet list toggles makeUnorderedList ↔ removeList based on path', () => {
    const stub = makeStubEditor('BODY>P');
    const { rerender } = render(<ComposerToolbar editor={stub as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bullet list' }));
    expect(stub.calls.some((c) => c.name === 'makeUnorderedList')).toBe(true);

    stub.setPath('BODY>UL>LI');
    act(() => stub.fire('pathChange'));
    rerender(<ComposerToolbar editor={stub as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bullet list' }));
    expect(stub.calls.some((c) => c.name === 'removeList')).toBe(true);
  });

  it('Inline code uses changeFormat — not code() — to avoid PRE wrapping on collapsed cursor', () => {
    const stub = makeStubEditor('BODY>P');
    render(<ComposerToolbar editor={stub as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inline code' }));
    expect(stub.calls.some((c) => c.name === 'code')).toBe(false);
    const cf = stub.calls.find((c) => c.name === 'changeFormat');
    expect(cf).toBeDefined();
    expect((cf?.args[0] as { tag: string }).tag).toBe('CODE');
  });

  it('Code block button calls editor.code() (block path)', () => {
    const stub = makeStubEditor('BODY>P');
    render(<ComposerToolbar editor={stub as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Code block' }));
    expect(stub.calls.some((c) => c.name === 'code')).toBe(true);
  });

  it('Quote button toggles increase ↔ decrease based on BLOCKQUOTE presence', () => {
    const stub = makeStubEditor('BODY>P');
    const { rerender } = render(<ComposerToolbar editor={stub as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Quote' }));
    expect(stub.calls.some((c) => c.name === 'increaseQuoteLevel')).toBe(true);

    stub.setPath('BODY>BLOCKQUOTE>P');
    act(() => stub.fire('pathChange'));
    rerender(<ComposerToolbar editor={stub as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Quote' }));
    expect(stub.calls.some((c) => c.name === 'decreaseQuoteLevel')).toBe(true);
  });

  it('Clear formatting button calls removeAllFormatting', () => {
    const stub = makeStubEditor('BODY>P');
    render(<ComposerToolbar editor={stub as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear formatting' }));
    expect(stub.calls.some((c) => c.name === 'removeAllFormatting')).toBe(true);
  });

  it('refocuses the editor after every command (selection survives toolbar click)', () => {
    const stub = makeStubEditor('BODY>P');
    render(<ComposerToolbar editor={stub as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(stub.calls.some((c) => c.name === 'focus')).toBe(true);
  });
});

describe('ComposerToolbar — active-state visualization', () => {
  it('reflects path via aria-pressed', () => {
    const stub = makeStubEditor('BODY>P>B');
    render(<ComposerToolbar editor={stub as never} />);
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Italic' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('updates active state when Squire emits pathChange', () => {
    const stub = makeStubEditor('BODY>P');
    render(<ComposerToolbar editor={stub as never} />);
    expect(screen.getByRole('button', { name: 'Italic' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    stub.setPath('BODY>P>EM');
    act(() => stub.fire('pathChange'));
    expect(screen.getByRole('button', { name: 'Italic' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('ComposerToolbar — a11y', () => {
  it('has zero axe-core violations against WCAG 2.1 AA', async () => {
    const stub = makeStubEditor('BODY>P');
    const { container } = render(<ComposerToolbar editor={stub as never} />);
    const violations = await runAxe(container);
    expect(violations.map((v) => v.id)).toEqual([]);
  });
});
