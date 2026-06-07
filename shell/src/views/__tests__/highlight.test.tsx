/**
 * @vitest-environment jsdom
 *
 * Tests for the search-highlight helpers (PR 53 / CoWork #15).
 *
 * Each helper is pure; the React-side `<Highlight>` just hangs styled
 * `<mark>` elements around the segmented output.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Highlight, buildSnippet, segment, tokenize } from '../highlight.js';

afterEach(() => {
  cleanup();
});

describe('tokenize', () => {
  it('splits on whitespace and lowercases', () => {
    expect(tokenize('Hello World')).toEqual(['hello', 'world']);
  });
  it('drops single-character tokens to avoid noise', () => {
    expect(tokenize('a b cd')).toEqual(['cd']);
  });
  it('dedupes repeated tokens', () => {
    expect(tokenize('foo Foo FOO bar')).toEqual(['foo', 'bar']);
  });
  it('returns empty for empty / all-whitespace queries', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   \t  ')).toEqual([]);
  });
});

describe('segment', () => {
  it('returns one non-match segment for empty token list', () => {
    expect(segment('hello world', [])).toEqual([
      { text: 'hello world', match: false },
    ]);
  });

  it('returns empty array for empty text', () => {
    expect(segment('', ['x'])).toEqual([]);
  });

  it('marks a single token, preserving original casing', () => {
    expect(segment('Hello World', ['world'])).toEqual([
      { text: 'Hello ', match: false },
      { text: 'World', match: true },
    ]);
  });

  it('handles multiple non-overlapping tokens', () => {
    expect(segment('foo bar baz', ['foo', 'baz'])).toEqual([
      { text: 'foo', match: true },
      { text: ' bar ', match: false },
      { text: 'baz', match: true },
    ]);
  });

  it('picks the longest match when tokens overlap (johnny over john)', () => {
    expect(segment('johnny appleseed', ['john', 'johnny'])).toEqual([
      { text: 'johnny', match: true },
      { text: ' appleseed', match: false },
    ]);
  });

  it('merges adjacent matches into one segment', () => {
    // Two consecutive matches with no gap should not produce two
    // separate `<mark>` elements (which would add a visible seam).
    expect(segment('foobar', ['foo', 'bar'])).toEqual([
      { text: 'foobar', match: true },
    ]);
  });

  it('matches inside a larger word (substring, not whole-word only)', () => {
    expect(segment('encyclopedia', ['cyclo'])).toEqual([
      { text: 'en', match: false },
      { text: 'cyclo', match: true },
      { text: 'pedia', match: false },
    ]);
  });
});

describe('buildSnippet', () => {
  it('returns the text unchanged when shorter than maxLen', () => {
    expect(buildSnippet('short text', ['xxx'], 120)).toBe('short text');
  });

  it('centers the window on the first match', () => {
    const filler = 'abcdefghij '.repeat(20); // 220 chars
    const text = `${filler}MATCH ${filler}`;
    const out = buildSnippet(text, ['match'], 50);
    expect(out).toContain('MATCH');
    expect(out.startsWith('…') || out.endsWith('…')).toBe(true);
  });

  it('returns a leading-window snippet when no token matches', () => {
    const text = 'a'.repeat(200);
    const out = buildSnippet(text, ['zzz'], 50);
    // No '…' prefix — the window starts at 0.
    expect(out.startsWith('…')).toBe(false);
    // Trailing '…' because we cut off the middle/end.
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('Highlight (component)', () => {
  it('renders plain text unchanged when no tokens', () => {
    render(<Highlight text="hello world" tokens={[]} />);
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('wraps matches in <mark> with the original casing preserved', () => {
    const { container } = render(
      <Highlight text="Hello World" tokens={['hello']} />,
    );
    const mark = container.querySelector('mark');
    expect(mark).not.toBeNull();
    expect(mark?.textContent).toBe('Hello');
  });

  it('skips empty token arrays — zero <mark> overhead', () => {
    const { container } = render(<Highlight text="anything" tokens={[]} />);
    expect(container.querySelectorAll('mark')).toHaveLength(0);
  });
});
