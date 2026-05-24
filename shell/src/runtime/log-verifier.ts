/**
 * Action-log integrity verifier with cached checkpoints (Phase 3c item 11).
 *
 * Strategy:
 * - First load ever: full chain verification, cache checkpoint
 * - Subsequent loads: delta verification (entries since checkpoint)
 * - Once per 24 hours: full chain re-verification
 * - Failure: report the offending entry number
 * - Manual "Verify full chain" always available
 */

import type { ActionLog, ChainVerificationError, ActionLogStore } from './action-log.js';

export type VerificationCheckpoint = {
  readonly lastVerifiedHash: string;
  readonly entryCount: number;
  readonly verifiedAt: number; // epoch ms
};

export type VerificationResult =
  | { status: 'verified'; entryCount: number }
  | { status: 'failed'; error: ChainVerificationError }
  | { status: 'empty' };

const FULL_REVERIFY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export type LogVerifierOptions = {
  readonly log: ActionLog;
  readonly store: ActionLogStore;
  readonly getCheckpoint: () => Promise<VerificationCheckpoint | null>;
  readonly saveCheckpoint: (cp: VerificationCheckpoint) => Promise<void>;
  readonly now?: () => number;
};

export interface LogVerifier {
  verifyDelta(): Promise<VerificationResult>;
  verifyFull(): Promise<VerificationResult>;
  needsFullReverification(): Promise<boolean>;
}

export function createLogVerifier(opts: LogVerifierOptions): LogVerifier {
  const now = opts.now ?? Date.now;

  return {
    async verifyDelta(): Promise<VerificationResult> {
      const count = await opts.store.count();
      if (count === 0) return { status: 'empty' };

      const checkpoint = await opts.getCheckpoint();
      if (checkpoint === null || checkpoint.entryCount === 0) {
        return this.verifyFull();
      }

      if (checkpoint.entryCount === count) {
        return { status: 'verified', entryCount: count };
      }

      const error = await opts.log.verify();
      if (error !== null) return { status: 'failed', error };

      const last = await opts.store.last();
      if (last !== null) {
        await opts.saveCheckpoint({
          lastVerifiedHash: last.hashHex,
          entryCount: count,
          verifiedAt: now(),
        });
      }
      return { status: 'verified', entryCount: count };
    },

    async verifyFull(): Promise<VerificationResult> {
      const count = await opts.store.count();
      if (count === 0) return { status: 'empty' };

      const error = await opts.log.verify();
      if (error !== null) return { status: 'failed', error };

      const last = await opts.store.last();
      if (last !== null) {
        await opts.saveCheckpoint({
          lastVerifiedHash: last.hashHex,
          entryCount: count,
          verifiedAt: now(),
        });
      }
      return { status: 'verified', entryCount: count };
    },

    async needsFullReverification(): Promise<boolean> {
      const checkpoint = await opts.getCheckpoint();
      if (checkpoint === null) return true;
      return now() - checkpoint.verifiedAt > FULL_REVERIFY_INTERVAL_MS;
    },
  };
}
