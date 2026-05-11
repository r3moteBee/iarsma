/**
 * ComposeView — modal new-message / reply composer (Phase 2 work
 * item 4). See `docs/compose-ui.md` for the surface design.
 *
 * Lifecycle (summary; full diagram in `docs/compose-ui.md`):
 *   - State `composeStateAtom` flips to `{ kind: 'open', prefill }`.
 *   - User fills fields. Field-blur triggers a debounced 500ms call
 *     to `useMailDraft().commit()` which JMAP-creates the draft.
 *   - "Send" calls `useMailSend().preview()` → renders a confirmation
 *     modal. "Send" inside the confirmation calls `commit()` and
 *     closes the composer on success.
 *   - "Cancel" / Esc / backdrop closes (draft persists; Discard
 *     support lands when `mail.draft.delete` does).
 *
 * Identity (item 6 dependency): `identityId` is a placeholder string
 * here. Item 6 wires `Identity/get` + a selector dropdown. Until then,
 * commits will fail with `forbiddenMailFrom` from the JMAP server; the
 * UI surfaces the error correctly. Save-as-draft is fully functional.
 */

import { useAtom, useAtomValue } from 'jotai';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { tokensAtom } from '../auth-state.js';
import { composeStateAtom, type ComposePrefill } from '../compose-state.js';
import { useMailDraft } from '../generated/capabilities/mail-draft.js';
import {
  useMailSend,
  type MailSendPreview,
} from '../generated/capabilities/mail-send.js';
import { useMailboxList } from '../generated/capabilities/mailbox-list.js';
import {
  formatRecipients,
  parseRecipients,
  type ParsedRecipient,
} from './recipient-parser.js';
import { Composer } from './composer.js';

/** Placeholder identity. Phase 2 item 6 replaces this with a selector. */
const PLACEHOLDER_IDENTITY_ID = 'placeholder-identity';

/** Debounce window before save-on-blur fires mail.draft.commit. */
const SAVE_DEBOUNCE_MS = 500;

export function ComposeView() {
  const [state, setState] = useAtom(composeStateAtom);
  if (state.kind === 'closed') return null;
  return (
    <ComposeModal
      prefill={state.prefill}
      onClose={() => setState({ kind: 'closed' })}
    />
  );
}

function ComposeModal(props: {
  readonly prefill: ComposePrefill;
  readonly onClose: () => void;
}) {
  const { prefill, onClose } = props;
  const tokens = useAtomValue(tokensAtom);
  const fromEmail = tokens?.email ?? 'unknown@example.invalid';
  const mailboxes = useMailboxList({});
  const draftHook = useMailDraft();
  const sendHook = useMailSend();

  const draftsMailboxId = useMemo(
    () => findMailboxIdByRole(mailboxes.data, 'drafts'),
    [mailboxes.data],
  );
  const sentMailboxId = useMemo(
    () => findMailboxIdByRole(mailboxes.data, 'sent'),
    [mailboxes.data],
  );

  // Form fields. `to`/`cc`/`bcc` are plain strings; parsed lazily.
  const [toText, setToText] = useState(formatRecipients(prefill.to));
  const [ccText, setCcText] = useState(formatRecipients(prefill.cc));
  const [bccText, setBccText] = useState(formatRecipients(prefill.bcc));
  const [subject, setSubject] = useState(prefill.subject ?? '');
  const [bodyHtml, setBodyHtml] = useState(prefill.bodyHtml ?? '');
  // `bodyText` is derived from the composer's HTML for the JMAP request.
  // Phase 2 ships single-format-at-a-time: if the user pasted HTML we
  // send HTML; otherwise a plain-text body. The composer is HTML-first
  // either way (it's a contenteditable surface).
  const [draftError, setDraftError] = useState<string | null>(null);
  const [sendPreview, setSendPreview] = useState<MailSendPreview | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const parsedTo = useMemo(() => parseRecipients(toText), [toText]);
  const parsedCc = useMemo(() => parseRecipients(ccText), [ccText]);
  const parsedBcc = useMemo(() => parseRecipients(bccText), [bccText]);

  const hasRecipientErrors =
    parsedTo.errors.length > 0 ||
    parsedCc.errors.length > 0 ||
    parsedBcc.errors.length > 0;
  const hasAtLeastOneRecipient = parsedTo.recipients.length > 0;

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocusedRef.current =
      typeof document !== 'undefined'
        ? (document.activeElement as HTMLElement | null)
        : null;
    dialogRef.current?.focus();
    return () => {
      previouslyFocusedRef.current?.focus();
    };
  }, []);

  // Esc closes (matches the keyboard help overlay pattern).
  const onDialogKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [onClose],
  );

  // Save-on-blur: debounced commit through useMailDraft. Phase 2 item 4
  // creates a fresh draft each save (mail.draft only supports create
  // today; mail.draft.update lands later). The most recent draft id is
  // remembered in `lastDraftIdRef` so future updates / deletes can
  // target it.
  const lastDraftIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // doSaveDraft closes over form state; the setTimeout callback fires
  // 500ms later and must call the LATEST doSaveDraft (with current
  // form values). Holding it in a ref avoids the stale closure that
  // would otherwise call the doSaveDraft from when triggerDebouncedSave
  // was first created.
  const doSaveDraftRef = useRef<() => Promise<void>>(async () => {});

  const triggerDebouncedSave = useCallback(() => {
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void doSaveDraftRef.current();
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const doSaveDraft = useCallback(async () => {
    setDraftError(null);
    if (draftsMailboxId === null) {
      setDraftError(
        'No Drafts mailbox found. Configure a mailbox with role "drafts" on the server.',
      );
      return;
    }
    // Skip empty drafts (no subject, no body, no recipients).
    const trimmedSubject = subject.trim();
    const trimmedBody = bodyHtml.trim();
    if (
      parsedTo.recipients.length === 0 &&
      parsedCc.recipients.length === 0 &&
      parsedBcc.recipients.length === 0 &&
      trimmedSubject === '' &&
      trimmedBody === ''
    ) {
      return;
    }
    try {
      const result = await draftHook.commit({
        mailboxId: draftsMailboxId,
        from: { email: fromEmail },
        to:
          parsedTo.recipients.length > 0
            ? parsedTo.recipients
            : [{ email: 'unknown@example.invalid' }],
        ...(parsedCc.recipients.length > 0 ? { cc: parsedCc.recipients } : {}),
        ...(parsedBcc.recipients.length > 0 ? { bcc: parsedBcc.recipients } : {}),
        subject: trimmedSubject,
        ...(trimmedBody !== '' ? { bodyHtml: trimmedBody } : {}),
        ...(prefill.inReplyTo !== undefined ? { inReplyTo: prefill.inReplyTo } : {}),
        ...(prefill.references !== undefined
          ? { references: prefill.references }
          : {}),
      });
      lastDraftIdRef.current = result.emailId;
    } catch (e) {
      setDraftError(
        e instanceof Error ? e.message : 'Failed to save draft.',
      );
    }
  }, [
    draftHook,
    draftsMailboxId,
    fromEmail,
    parsedTo,
    parsedCc,
    parsedBcc,
    subject,
    bodyHtml,
    prefill.inReplyTo,
    prefill.references,
  ]);

  // Keep the latest doSaveDraft pinned in the ref the debounce reads.
  useEffect(() => {
    doSaveDraftRef.current = doSaveDraft;
  }, [doSaveDraft]);

  // Clean up the timer on unmount.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const onSendClick = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setSendError(null);
      if (sentMailboxId === null) {
        setSendError(
          'No Sent mailbox found. Configure a mailbox with role "sent" on the server.',
        );
        return;
      }
      if (!hasAtLeastOneRecipient) {
        setSendError('At least one recipient is required.');
        return;
      }
      if (hasRecipientErrors) {
        setSendError('Fix invalid recipients before sending.');
        return;
      }
      try {
        const input = buildSendInput({
          sentMailboxId,
          fromEmail,
          parsedTo: parsedTo.recipients,
          parsedCc: parsedCc.recipients,
          parsedBcc: parsedBcc.recipients,
          subject,
          bodyHtml,
          prefill,
        });
        // Codegen-generated `useMailSend` is typed
        // `preview: (input) => Promise<DryRunPreview<MailSendOutput>>`
        // but the invoker returns the natural preview shape directly
        // (no `{output, effects, policy}` wrapper). Cast through
        // unknown to the generated `MailSendPreview` type. Follow-up:
        // teach the codegen to thread the preview type through the
        // hook return type (`useWriteHook<I, O, P>`).
        const preview = (await sendHook.preview(input)) as unknown as MailSendPreview;
        setSendPreview(preview);
      } catch (err) {
        setSendError(
          err instanceof Error ? err.message : 'Failed to preview send.',
        );
      }
    },
    [
      sentMailboxId,
      hasAtLeastOneRecipient,
      hasRecipientErrors,
      fromEmail,
      parsedTo.recipients,
      parsedCc.recipients,
      parsedBcc.recipients,
      subject,
      bodyHtml,
      prefill,
      sendHook,
    ],
  );

  const onPreviewConfirm = useCallback(async () => {
    if (sentMailboxId === null) return;
    setSendError(null);
    try {
      const input = buildSendInput({
        sentMailboxId,
        fromEmail,
        parsedTo: parsedTo.recipients,
        parsedCc: parsedCc.recipients,
        parsedBcc: parsedBcc.recipients,
        subject,
        bodyHtml,
        prefill,
      });
      await sendHook.commit(input);
      setSendPreview(null);
      onClose();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send.');
      setSendPreview(null);
    }
  }, [
    sentMailboxId,
    fromEmail,
    parsedTo.recipients,
    parsedCc.recipients,
    parsedBcc.recipients,
    subject,
    bodyHtml,
    prefill,
    sendHook,
    onClose,
  ]);

  return (
    <>
      <div
        role="presentation"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.4)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: '4em 1em',
          zIndex: 900,
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="compose-title"
          tabIndex={-1}
          onKeyDown={onDialogKeyDown}
          onClick={(e) => e.stopPropagation()}
          style={{
            background: 'white',
            color: 'black',
            maxWidth: '40em',
            width: '100%',
            maxHeight: '85vh',
            overflow: 'auto',
            padding: '1.25em',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          }}
        >
          <header
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginBottom: '0.75em',
            }}
          >
            <h2 id="compose-title" style={{ margin: 0 }}>
              {prefill.inReplyTo !== undefined ? 'Reply' : 'New message'}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close compose"
            >
              Cancel
            </button>
          </header>
          <form onSubmit={onSendClick}>
            <FieldRow label="From">
              <output style={{ opacity: 0.75 }}>{fromEmail}</output>
            </FieldRow>
            <FieldRow label="To" htmlFor="compose-to">
              <input
                id="compose-to"
                type="text"
                value={toText}
                onChange={(e) => setToText(e.target.value)}
                onBlur={triggerDebouncedSave}
                aria-invalid={parsedTo.errors.length > 0}
                aria-describedby={
                  parsedTo.errors.length > 0 ? 'compose-to-errors' : undefined
                }
                placeholder="alice@example.net, Bob <bob@example.net>"
                style={fieldStyle}
              />
              {parsedTo.errors.length > 0 ? (
                <p
                  id="compose-to-errors"
                  role="alert"
                  style={errorStyle}
                >
                  Invalid recipient(s): {parsedTo.errors.join(', ')}
                </p>
              ) : null}
            </FieldRow>
            <FieldRow label="Cc" htmlFor="compose-cc">
              <input
                id="compose-cc"
                type="text"
                value={ccText}
                onChange={(e) => setCcText(e.target.value)}
                onBlur={triggerDebouncedSave}
                aria-invalid={parsedCc.errors.length > 0}
                style={fieldStyle}
              />
              {parsedCc.errors.length > 0 ? (
                <p role="alert" style={errorStyle}>
                  Invalid recipient(s): {parsedCc.errors.join(', ')}
                </p>
              ) : null}
            </FieldRow>
            <FieldRow label="Bcc" htmlFor="compose-bcc">
              <input
                id="compose-bcc"
                type="text"
                value={bccText}
                onChange={(e) => setBccText(e.target.value)}
                onBlur={triggerDebouncedSave}
                aria-invalid={parsedBcc.errors.length > 0}
                style={fieldStyle}
              />
              {parsedBcc.errors.length > 0 ? (
                <p role="alert" style={errorStyle}>
                  Invalid recipient(s): {parsedBcc.errors.join(', ')}
                </p>
              ) : null}
            </FieldRow>
            <FieldRow label="Subject" htmlFor="compose-subject">
              <input
                id="compose-subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                onBlur={triggerDebouncedSave}
                style={fieldStyle}
              />
            </FieldRow>
            <div
              style={{
                marginTop: '0.5em',
              }}
              onBlur={triggerDebouncedSave}
            >
              <Composer
                label="Message body"
                value={bodyHtml}
                onChange={setBodyHtml}
              />
            </div>
            {draftError !== null ? (
              <p role="alert" style={errorStyle}>
                Draft save failed: {draftError}
              </p>
            ) : null}
            {sendError !== null ? (
              <p role="alert" style={errorStyle}>
                Send failed: {sendError}
              </p>
            ) : null}
            <footer
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '0.5em',
                marginTop: '0.75em',
              }}
            >
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  !hasAtLeastOneRecipient ||
                  hasRecipientErrors ||
                  sentMailboxId === null
                }
              >
                Send…
              </button>
            </footer>
          </form>
        </div>
      </div>
      {sendPreview !== null ? (
        <SendPreviewModal
          preview={sendPreview}
          onCancel={() => setSendPreview(null)}
          onConfirm={onPreviewConfirm}
        />
      ) : null}
    </>
  );
}

function FieldRow(props: {
  readonly label: string;
  readonly htmlFor?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', gap: '0.5em', marginBottom: '0.5em' }}>
      <label
        htmlFor={props.htmlFor}
        style={{ flex: '0 0 4em', paddingTop: '0.4em', fontWeight: 600 }}
      >
        {props.label}
      </label>
      <div style={{ flex: '1 1 auto' }}>{props.children}</div>
    </div>
  );
}

const fieldStyle = {
  width: '100%',
  padding: '0.4em 0.5em',
  border: '1px solid rgba(0,0,0,0.2)',
  borderRadius: 4,
  font: 'inherit',
};

const errorStyle = {
  color: '#b00020',
  fontSize: '0.9em',
  margin: '0.25em 0 0',
};

function SendPreviewModal(props: {
  readonly preview: MailSendPreview;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const { preview, onCancel, onConfirm } = props;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);
  return (
    <div
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-preview-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
        style={{
          background: 'white',
          color: 'black',
          maxWidth: '36em',
          width: '100%',
          padding: '1.25em',
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        }}
      >
        <h2 id="send-preview-title" style={{ marginTop: 0 }}>
          Send this message?
        </h2>
        <dl style={{ margin: 0 }}>
          <dt style={{ fontWeight: 600 }}>To</dt>
          <dd style={{ margin: '0 0 0.5em' }}>
            {preview.recipients.to.map((a) => a.email).join(', ')}
          </dd>
          {preview.recipients.cc !== undefined &&
          preview.recipients.cc.length > 0 ? (
            <>
              <dt style={{ fontWeight: 600 }}>Cc</dt>
              <dd style={{ margin: '0 0 0.5em' }}>
                {preview.recipients.cc.map((a) => a.email).join(', ')}
              </dd>
            </>
          ) : null}
          {preview.recipients.bcc !== undefined &&
          preview.recipients.bcc.length > 0 ? (
            <>
              <dt style={{ fontWeight: 600 }}>Bcc</dt>
              <dd style={{ margin: '0 0 0.5em' }}>
                {preview.recipients.bcc.map((a) => a.email).join(', ')}
              </dd>
            </>
          ) : null}
          <dt style={{ fontWeight: 600 }}>Subject</dt>
          <dd style={{ margin: '0 0 0.5em' }}>{preview.subject}</dd>
          <dt style={{ fontWeight: 600 }}>Body preview</dt>
          <dd
            style={{
              margin: '0 0 0.5em',
              padding: '0.5em',
              background: 'rgba(0,0,0,0.04)',
              borderRadius: 4,
              whiteSpace: 'pre-wrap',
            }}
          >
            {preview.bodyPreview === ''
              ? '(empty body)'
              : preview.bodyPreview}
          </dd>
          <dt style={{ fontWeight: 600 }}>Estimated send time</dt>
          <dd style={{ margin: '0 0 0.5em' }}>{preview.estimatedSendTime}</dd>
          <dt style={{ fontWeight: 600 }}>Estimated size</dt>
          <dd style={{ margin: '0 0 0.5em' }}>{preview.estimatedSize} B</dd>
        </dl>
        <footer
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.5em',
            marginTop: '0.75em',
          }}
        >
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm}>
            Send
          </button>
        </footer>
      </div>
    </div>
  );
}

function findMailboxIdByRole(
  data: unknown,
  role: 'drafts' | 'sent',
): string | null {
  if (!Array.isArray(data)) return null;
  for (const m of data) {
    if (
      m !== null &&
      typeof m === 'object' &&
      (m as { role?: unknown }).role === role
    ) {
      const id = (m as { id?: unknown }).id;
      if (typeof id === 'string') return id;
    }
  }
  return null;
}

function buildSendInput(args: {
  sentMailboxId: string;
  fromEmail: string;
  parsedTo: ReadonlyArray<ParsedRecipient>;
  parsedCc: ReadonlyArray<ParsedRecipient>;
  parsedBcc: ReadonlyArray<ParsedRecipient>;
  subject: string;
  bodyHtml: string;
  prefill: ComposePrefill;
}) {
  return {
    sentMailboxId: args.sentMailboxId,
    identityId: PLACEHOLDER_IDENTITY_ID,
    from: { email: args.fromEmail },
    to: args.parsedTo as Array<ParsedRecipient>,
    ...(args.parsedCc.length > 0
      ? { cc: args.parsedCc as Array<ParsedRecipient> }
      : {}),
    ...(args.parsedBcc.length > 0
      ? { bcc: args.parsedBcc as Array<ParsedRecipient> }
      : {}),
    subject: args.subject,
    ...(args.bodyHtml.trim() !== '' ? { bodyHtml: args.bodyHtml } : {}),
    ...(args.prefill.inReplyTo !== undefined
      ? { inReplyTo: args.prefill.inReplyTo }
      : {}),
    ...(args.prefill.references !== undefined
      ? { references: args.prefill.references }
      : {}),
  };
}
