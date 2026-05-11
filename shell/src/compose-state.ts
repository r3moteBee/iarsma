/**
 * Global compose-modal state (Phase 2 work item 4).
 *
 * Open/closed is driven by an atom so any view can open the composer
 * (the inbox header's "Compose" button today; future entry points for
 * reply / forward / drafts-panel reopen will piggyback on the same
 * atom with a populated `prefill` payload).
 */

import { atom } from 'jotai';

export type ComposePrefill = {
  readonly to?: ReadonlyArray<{ name?: string; email: string }>;
  readonly cc?: ReadonlyArray<{ name?: string; email: string }>;
  readonly bcc?: ReadonlyArray<{ name?: string; email: string }>;
  readonly subject?: string;
  readonly bodyHtml?: string;
  readonly bodyText?: string;
  readonly inReplyTo?: string;
  readonly references?: string;
};

export type ComposeState =
  | { readonly kind: 'closed' }
  | { readonly kind: 'open'; readonly prefill: ComposePrefill };

export const composeStateAtom = atom<ComposeState>({ kind: 'closed' });
