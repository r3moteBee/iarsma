/**
 * Jotai atom helpers for read-hook caching.
 *
 * Each capability gets an atomFamily keyed by canonicalized input JSON,
 * so calls with the same input share state across components. Push events
 * from JMAP can invalidate atoms by reaching into the family with the
 * relevant key.
 */

import { atom, type PrimitiveAtom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { canonicalize } from './canonical.js';
import type { AsyncResult } from './types.js';

/**
 * Build an atomFamily for a capability's read state. The family key is the
 * canonicalized input; equivalent inputs share an atom.
 */
export function makeResultAtomFamily<I, O>(): (input: I) => PrimitiveAtom<AsyncResult<O>> {
  return atomFamily(
    (_input: I) => atom<AsyncResult<O>>({ status: 'idle' }),
    (a, b) => canonicalize(a) === canonicalize(b),
  );
}
