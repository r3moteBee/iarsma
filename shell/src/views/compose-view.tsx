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
import { useIdentityList } from '../generated/capabilities/identity-list.js';
import {
  useMailSend,
  type MailSendPreview,
} from '../generated/capabilities/mail-send.js';
import { useMailboxList } from '../generated/capabilities/mailbox-list.js';
import { useInvoker } from '../runtime/invoker.js';
import type { AttachmentRef, Identity } from '../runtime/jmap-client.js';
import { previewHashHex } from '../runtime/preview-hash.js';
import {
  formatRecipients,
  parseRecipients,
  type ParsedRecipient,
} from './recipient-parser.js';
import { Composer } from './composer.js';

/** Debounce window before save-on-blur fires mail.draft.commit. */
const SAVE_DEBOUNCE_MS = 500;

type UploadedAttachment = {
  readonly blobId: string;
  readonly name: string;
  readonly type: string;
  readonly size: number;
};

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
  const invoker = useInvoker();
  const mailboxes = useMailboxList({});
  const identityList = useIdentityList({});
  const draftHook = useMailDraft();
  const sendHook = useMailSend();

  // Attachments. Each `UploadedAttachment` is a successful upload; the
  // user can remove them with the per-row button (no server-side
  // cleanup — Stalwart sweeps orphan blobs on its own schedule).
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  // Per-file upload state surfaced inline below the picker.
  const [uploadsInFlight, setUploadsInFlight] = useState<number>(0);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  const onFilesChange = useCallback(
    async (files: FileList | null) => {
      if (files === null || files.length === 0) return;
      if (invoker.uploadAttachment === undefined) {
        setAttachmentError(
          'This deployment does not support attachment uploads.',
        );
        return;
      }
      setAttachmentError(null);
      // Snapshot the list now — `files` is consumed by the input
      // reset below.
      const list: File[] = Array.from(files);
      setUploadsInFlight((n) => n + list.length);
      const results: UploadedAttachment[] = [];
      const errors: string[] = [];
      for (const file of list) {
        try {
          const r = await invoker.uploadAttachment!(file, {
            name: file.name,
            type: file.type,
          });
          results.push({
            blobId: r.blobId,
            name: file.name,
            type: r.type || file.type || 'application/octet-stream',
            size: r.size,
          });
        } catch (e) {
          errors.push(
            `${file.name}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      setAttachments((prev) => [...prev, ...results]);
      setUploadsInFlight((n) => n - list.length);
      if (errors.length > 0) {
        setAttachmentError(`Upload failed: ${errors.join('; ')}`);
      }
    },
    [invoker],
  );

  const removeAttachment = useCallback((blobId: string) => {
    setAttachments((prev) => prev.filter((a) => a.blobId !== blobId));
  }, []);

  const draftsMailboxId = useMemo(
    () => findMailboxIdByRole(mailboxes.data, 'drafts'),
    [mailboxes.data],
  );
  const sentMailboxId = useMemo(
    () => findMailboxIdByRole(mailboxes.data, 'sent'),
    [mailboxes.data],
  );

  // Identity selection: default to the first identity (item 6's first
  // cut). "Per-recipient-domain" and "per-mailbox" rules land later
  // when the UX has more shape. Falls back to a placeholder until
  // identities load; the Send button gates on a real identity.
  const identities: ReadonlyArray<Identity> = useMemo(
    () =>
      (identityList.data as { identities?: ReadonlyArray<Identity> } | undefined)
        ?.identities ?? [],
    [identityList.data],
  );
  const [selectedIdentityId, setSelectedIdentityId] = useState<string | null>(
    null,
  );
  // When identities arrive (or change), pick the first one if the user
  // hasn't manually changed selection.
  useEffect(() => {
    if (selectedIdentityId !== null) return;
    if (identities.length === 0) return;
    setSelectedIdentityId(identities[0]!.id);
  }, [identities, selectedIdentityId]);

  const selectedIdentity = useMemo(
    () => identities.find((i) => i.id === selectedIdentityId) ?? null,
    [identities, selectedIdentityId],
  );
  // The composer's "From" address derives from the selected identity.
  // Until identities load we show the token-stamped email as a
  // placeholder; capabilities won't actually call until selectedIdentity
  // is set (Send is disabled).
  const fromEmail =
    selectedIdentity?.email ?? tokens?.email ?? 'unknown@example.invalid';
  const fromName = selectedIdentity?.name;

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
  // SHA-384 of the canonical-form preview the user is about to
  // approve (D-047). Computed alongside setSendPreview so the
  // confirmation path can pass it to commit() and the action-log
  // entry binds to the exact preview shown.
  const [sendPreviewHash, setSendPreviewHash] = useState<string | null>(
    null,
  );
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
        ...(attachments.length > 0
          ? { attachments: attachments.map(toAttachmentRef) }
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
    attachments,
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
      if (selectedIdentity === null) {
        setSendError('No identity selected. Configure an Identity on the server first.');
        return;
      }
      try {
        const input = buildSendInput({
          sentMailboxId,
          identityId: selectedIdentity.id,
          fromEmail,
          ...(fromName !== undefined ? { fromName } : {}),
          parsedTo: parsedTo.recipients,
          parsedCc: parsedCc.recipients,
          parsedBcc: parsedBcc.recipients,
          subject,
          bodyHtml,
          prefill,
          attachments,
        });
        // Codegen-generated `useMailSend` is typed
        // `preview: (input) => Promise<DryRunPreview<MailSendOutput>>`
        // but the invoker returns the natural preview shape directly
        // (no `{output, effects, policy}` wrapper). Cast through
        // unknown to the generated `MailSendPreview` type. Follow-up:
        // teach the codegen to thread the preview type through the
        // hook return type (`useWriteHook<I, O, P>`).
        const preview = (await sendHook.preview(input)) as unknown as MailSendPreview;
        // Compute the SHA-384 of the canonical-form preview now, so
        // the action-log entry on commit binds to exactly the
        // preview the user is about to see (D-047 provenance).
        const hash = await previewHashHex(preview);
        setSendPreview(preview);
        setSendPreviewHash(hash);
      } catch (err) {
        setSendError(
          err instanceof Error ? err.message : 'Failed to preview send.',
        );
      }
    },
    [
      sentMailboxId,
      selectedIdentity,
      hasAtLeastOneRecipient,
      hasRecipientErrors,
      fromEmail,
      fromName,
      parsedTo.recipients,
      parsedCc.recipients,
      parsedBcc.recipients,
      subject,
      bodyHtml,
      prefill,
      attachments,
      sendHook,
    ],
  );

  const onPreviewConfirm = useCallback(async () => {
    if (sentMailboxId === null) return;
    if (selectedIdentity === null) return;
    setSendError(null);
    try {
      const input = buildSendInput({
        sentMailboxId,
        identityId: selectedIdentity.id,
        fromEmail,
        ...(fromName !== undefined ? { fromName } : {}),
        parsedTo: parsedTo.recipients,
        parsedCc: parsedCc.recipients,
        parsedBcc: parsedBcc.recipients,
        subject,
        bodyHtml,
        prefill,
        attachments,
      });
      // Pass the preview hash so the action-log entry binds to
      // exactly the preview the user approved (D-047 provenance).
      await sendHook.commit(
        input,
        sendPreviewHash !== null ? { previewHashHex: sendPreviewHash } : {},
      );
      setSendPreview(null);
      setSendPreviewHash(null);
      onClose();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send.');
      setSendPreview(null);
      setSendPreviewHash(null);
    }
  }, [
    sentMailboxId,
    selectedIdentity,
    fromEmail,
    fromName,
    parsedTo.recipients,
    parsedCc.recipients,
    parsedBcc.recipients,
    subject,
    bodyHtml,
    prefill,
    attachments,
    sendPreviewHash,
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
            background: 'var(--surface-1)',
            color: 'var(--text-1)',
            maxWidth: '40em',
            width: '100%',
            maxHeight: '85vh',
            overflow: 'auto',
            padding: '1.25em',
            borderRadius: 8,
            boxShadow: 'var(--shadow-md)',
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
            <FieldRow label="From" htmlFor="compose-identity">
              {identities.length === 0 ? (
                <output style={{ color: 'var(--text-2)' }}>
                  {identityList.isLoading
                    ? 'Loading identities…'
                    : 'No sending identities configured on the server.'}
                </output>
              ) : identities.length === 1 ? (
                // Single identity — render as static text + a hidden
                // select so the field row still associates with the
                // (auto-selected) value.
                <output style={{ color: 'var(--text-2)' }}>
                  {formatIdentityLabel(identities[0]!)}
                </output>
              ) : (
                <select
                  id="compose-identity"
                  value={selectedIdentityId ?? ''}
                  onChange={(e) => setSelectedIdentityId(e.target.value)}
                  style={fieldStyle}
                  aria-label="Sending identity"
                >
                  {identities.map((id) => (
                    <option key={id.id} value={id.id}>
                      {formatIdentityLabel(id)}
                    </option>
                  ))}
                </select>
              )}
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
            <AttachmentsPanel
              attachments={attachments}
              uploadsInFlight={uploadsInFlight}
              error={attachmentError}
              onFilesChange={onFilesChange}
              onRemove={removeAttachment}
            />
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
                  sentMailboxId === null ||
                  selectedIdentity === null ||
                  uploadsInFlight > 0
                }
              >
                {uploadsInFlight > 0 ? 'Uploading…' : 'Send…'}
              </button>
            </footer>
          </form>
        </div>
      </div>
      {sendPreview !== null ? (
        <SendPreviewModal
          preview={sendPreview}
          onCancel={() => {
            setSendPreview(null);
            setSendPreviewHash(null);
          }}
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
  border: '1px solid var(--surface-3)',
  borderRadius: 4,
  font: 'inherit',
  color: 'var(--text-1)',
  background: 'var(--surface-2)',
};

const errorStyle = {
  color: 'var(--destructive)',
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
          background: 'var(--surface-1)',
          color: 'var(--text-1)',
          maxWidth: '36em',
          width: '100%',
          padding: '1.25em',
          borderRadius: 8,
          boxShadow: 'var(--shadow-md)',
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
              background: 'var(--surface-2)',
              borderRadius: 4,
              whiteSpace: 'pre-wrap',
            }}
          >
            {preview.bodyPreview === ''
              ? '(empty body)'
              : preview.bodyPreview}
          </dd>
          {preview.attachmentCount > 0 ? (
            <>
              <dt style={{ fontWeight: 600 }}>Attachments</dt>
              <dd style={{ margin: '0 0 0.5em' }}>
                {preview.attachmentCount} file
                {preview.attachmentCount === 1 ? '' : 's'} (
                {preview.attachmentBlobIds.length} blob refs)
              </dd>
            </>
          ) : null}
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

function AttachmentsPanel(props: {
  readonly attachments: ReadonlyArray<UploadedAttachment>;
  readonly uploadsInFlight: number;
  readonly error: string | null;
  readonly onFilesChange: (files: FileList | null) => void;
  readonly onRemove: (blobId: string) => void;
}) {
  const { attachments, uploadsInFlight, error, onFilesChange, onRemove } =
    props;
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <section
      aria-label="Attachments"
      style={{
        marginTop: '0.75em',
        paddingTop: '0.5em',
        borderTop: '1px solid var(--surface-3)',
      }}
    >
      <div style={{ display: 'flex', gap: '0.5em', alignItems: 'baseline' }}>
        <h3
          style={{
            margin: 0,
            fontSize: '0.95em',
            fontWeight: 600,
            flex: '0 0 auto',
          }}
        >
          Attachments ({attachments.length})
        </h3>
        <input
          ref={inputRef}
          type="file"
          multiple
          aria-label="Attach files"
          onChange={(e) => {
            onFilesChange(e.target.files);
            // Reset the input so re-picking the same file fires onChange.
            if (inputRef.current !== null) inputRef.current.value = '';
          }}
          style={{ font: 'inherit' }}
        />
        {uploadsInFlight > 0 ? (
          <output style={{ color: 'var(--text-2)', fontSize: '0.9em' }}>
            Uploading {uploadsInFlight} file{uploadsInFlight === 1 ? '' : 's'}…
          </output>
        ) : null}
        {/* Reserved slot for the image-resize component (Phase 5).
            Today's flow is "drop file → upload at full size" — that's
            fine for 2-3 MB phone photos but punishing for 12+ MB
            screenshots. The slot will land an inline resize affordance
            (downscale to N px or X% quality) before the upload fires. */}
      </div>
      {error !== null ? (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      ) : null}
      {attachments.length > 0 ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0.5em 0 0' }}>
          {attachments.map((a) => (
            <li
              key={a.blobId}
              style={{
                display: 'flex',
                gap: '0.5em',
                padding: '0.25em 0',
                borderTop: '1px solid var(--surface-3)',
                alignItems: 'baseline',
              }}
            >
              <span style={{ flex: '1 1 auto' }}>{a.name}</span>
              <span style={{ flex: '0 0 auto', color: 'var(--text-2)' }}>{a.type}</span>
              <span
                style={{
                  flex: '0 0 auto',
                  color: 'var(--text-2)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatBytes(a.size)}
              </span>
              <button
                type="button"
                onClick={() => onRemove(a.blobId)}
                aria-label={`Remove ${a.name}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function toAttachmentRef(a: UploadedAttachment): AttachmentRef {
  // Default `disposition: attachment`. Inline-image rewriting is
  // reserved for a future polish PR (cid: rewriting on `<img
  // src="blob:...">` paste); when it lands, those entries carry
  // `disposition: 'inline'` and a `cid` matching the body html.
  return {
    blobId: a.blobId,
    name: a.name,
    type: a.type,
    size: a.size,
    disposition: 'attachment',
  };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatIdentityLabel(identity: Identity): string {
  return identity.name !== ''
    ? `${identity.name} <${identity.email}>`
    : identity.email;
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
  identityId: string;
  fromEmail: string;
  fromName?: string;
  parsedTo: ReadonlyArray<ParsedRecipient>;
  parsedCc: ReadonlyArray<ParsedRecipient>;
  parsedBcc: ReadonlyArray<ParsedRecipient>;
  subject: string;
  bodyHtml: string;
  prefill: ComposePrefill;
  attachments: ReadonlyArray<UploadedAttachment>;
}) {
  return {
    sentMailboxId: args.sentMailboxId,
    identityId: args.identityId,
    from:
      args.fromName !== undefined
        ? { name: args.fromName, email: args.fromEmail }
        : { email: args.fromEmail },
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
    ...(args.attachments.length > 0
      ? { attachments: args.attachments.map(toAttachmentRef) }
      : {}),
  };
}
