/**
 * Pure resolver: turn an `onUndoRegistered` notification for a UI folder
 * MOVE into the toast record the DeleteToast surfaces. A move is a
 * `mail.modify` whose patch sets exactly one mailbox to `true` (the
 * destination) — keyword-only modifies (flag/read) and agent-issued
 * calls return null (no toast). The inverse itself is already registered
 * by the loggingInvoker/undo-registry under `seq`.
 */
export type UndoRegisteredInfo = {
  readonly tool: string;
  readonly callerClass: string;
  readonly seq: number;
  readonly params: unknown;
};

export type MoveUndoRecord = {
  readonly seq: number;
  readonly count: number;
  readonly message: string;
};

export function resolveMoveUndo(
  info: UndoRegisteredInfo,
  lookupMailboxName: (id: string) => string,
): MoveUndoRecord | null {
  if (info.tool !== 'mail.modify' || info.callerClass !== 'ui') return null;
  const params = info.params as {
    emailIds?: readonly string[];
    patch?: { mailboxIds?: Readonly<Record<string, boolean>> };
  };
  const mailboxIds = params.patch?.mailboxIds;
  if (mailboxIds === undefined) return null;
  const destinations = Object.entries(mailboxIds)
    .filter(([, v]) => v === true)
    .map(([id]) => id);
  if (destinations.length !== 1) return null;
  const count = params.emailIds?.length ?? 0;
  if (count === 0) return null;
  const dest = lookupMailboxName(destinations[0]!);
  const message = count === 1 ? `Moved to ${dest}` : `${count} messages moved to ${dest}`;
  return { seq: info.seq, count, message };
}
