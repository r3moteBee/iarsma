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

import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { tokensAtom } from '../auth-state.js';
import { Button } from '../components/button.js';
import { Dialog } from '../components/dialog.js';
import { Notice } from '../components/notice.js';
import { PreviewCard } from '../components/preview-card.js';
import { RecipientField } from '../components/recipient-field.js';
import { composeStateAtom, type ComposePrefill } from '../compose-state.js';
import { useMailDraft } from '../generated/capabilities/mail-draft.js';
import { useIdentityList } from '../generated/capabilities/identity-list.js';
import {
  useMailSend,
  type MailSendPreview,
} from '../generated/capabilities/mail-send.js';
import { useMailboxList } from '../generated/capabilities/mailbox-list.js';
import { useInvoker } from '../runtime/invoker.js';
import type { AttachmentRef, Identity, MailSendInput } from '../runtime/jmap-client.js';
import { previewHashHex } from '../runtime/preview-hash.js';
import { useSendBufferOrNull } from '../runtime/send-buffer-context.js';
import { sendDelayMsAtom } from '../runtime/send-delay-state.js';
import { skipSendReviewAtom } from '../runtime/skip-send-review-state.js';
import { useRecentRecipients } from '../runtime/recent-recipients.js';
import {
  formatRecipients,
  parseRecipients,
  type ParsedRecipient,
} from './recipient-parser.js';
import type Squire from 'squire-rte';
import { Composer } from './composer.js';
import { ComposerToolbar } from './composer-toolbar.js';

// Lift the Composer's Squire instance so the toolbar can drive it.
// `null` while the editor is unmounted; set once Composer fires its
// `onEditorReady` callback.
type SquireInstance = Squire | null;
import styles from './compose-view.module.css';

const COMPOSE_FORM_ID = 'compose-form';

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
  // PR 24 — when the user has a non-zero send delay configured, buffer
  // the send locally and let the Undo toast catch a mistake within the
  // window. delay=0 falls through to the immediate sendHook.commit
  // path (no buffer, no undo).
  const sendBuffer = useSendBufferOrNull();
  const sendDelayMs = useAtomValue(sendDelayMsAtom);
  const skipSendReview = useAtomValue(skipSendReviewAtom);
  // U-5 — send-history feeds recipient autocomplete alongside contacts.
  const recentRecipients = useRecentRecipients();

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
  // U-9 — Cc/Bcc are progressively disclosed: hidden until the user asks
  // for them, but shown from the start when a reply/draft prefilled them.
  const [ccBccVisible, setCcBccVisible] = useState(
    () => (prefill.cc?.length ?? 0) > 0 || (prefill.bcc?.length ?? 0) > 0,
  );
  const [subject, setSubject] = useState(prefill.subject ?? '');
  const [bodyHtml, setBodyHtml] = useState(prefill.bodyHtml ?? '');
  // PR 52 / CoWork #6 — Squire instance is owned by Composer; the
  // toolbar reads it via this state. `null` until Composer mounts and
  // again after unmount, so the toolbar renders disabled in between.
  const [editor, setEditor] = useState<SquireInstance>(null);

  // PR 33 — auto-prepend the selected identity's textSignature when
  // composing a brand-new message (no prefill body, no draft body
  // yet). Replies + drafts skip this so the quoted content / saved
  // composition is never clobbered. Fires once per Compose session.
  const sigInsertedRef = useRef(false);
  // Auto-insert effect itself — placed here so it runs after the
  // body state is declared above. Fires once selectedIdentity
  // resolves; the ref guard prevents re-insertion.
  useEffect(() => {
    if (sigInsertedRef.current) return;
    if (selectedIdentity === null) return;
    if ((prefill.bodyHtml ?? '') !== '') {
      // Reply / draft / forward — leave existing content untouched.
      // Future polish: insert above the quoted block on replies.
      sigInsertedRef.current = true;
      return;
    }
    if (bodyHtml !== '') {
      // The user already typed something — don't clobber it.
      sigInsertedRef.current = true;
      return;
    }
    const sig = selectedIdentity.textSignature ?? '';
    if (sig.trim() === '') {
      sigInsertedRef.current = true;
      return;
    }
    // Two newlines between the (empty) message area and the
    // signature so the contenteditable shows a clean break.
    setBodyHtml(`\n\n${sig}`);
    sigInsertedRef.current = true;
  }, [selectedIdentity, prefill.bodyHtml, bodyHtml]);
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

  // PR 47 / CoWork #3 — only render the "Invalid recipient(s)"
  // alert AFTER the user leaves the field (or hits Send). Typing
  // "elle" mid-keystroke shouldn't fire a red error before they're
  // done. Send-time validation lives in the submit gate below.
  const [toBlurred, setToBlurred] = useState(false);
  const [ccBlurred, setCcBlurred] = useState(false);
  const [bccBlurred, setBccBlurred] = useState(false);

  const hasRecipientErrors =
    parsedTo.errors.length > 0 ||
    parsedCc.errors.length > 0 ||
    parsedBcc.errors.length > 0;
  const hasAtLeastOneRecipient = parsedTo.recipients.length > 0;

  // PR 5.5: focus trap, Escape handling, backdrop click — all handled
  // by the shared <Dialog> component now (native <dialog> + showModal).
  // The old dialogRef + previouslyFocusedRef + onDialogKeyDown
  // bookkeeping is gone; showModal saves/restores focus on its own.

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
      // PR 24 — buffer the send for the configured delay so the user
      // can hit Undo in the toast before it actually leaves. delay=0
      // and no-buffer environments (tests, unusual mounts) fall
      // through to the immediate commit so existing behaviour stays
      // intact.
      //
      // Caveat: the previewHashHex provenance binding is currently
      // dropped on the buffered path because the SendBuffer's
      // onFire calls invoker.invoke('mail.send', params) without
      // options. Acceptable for v1 — the buffered send still
      // commits and logs, just without the preview-hash link to
      // the dry-run. A follow-up can teach the buffer to carry
      // commit options through.
      // PR 26 — once the send actually commits, purge the autosaved
      // draft (otherwise Send leaves a stale copy in Drafts forever).
      // On the buffered path: the SendBuffer's onPurgeDraft runs the
      // purge inside its fire callback, so Undo (cancel-before-fire)
      // preserves the draft.
      const draftToPurge = lastDraftIdRef.current ?? undefined;
      if (sendBuffer !== null && sendDelayMs > 0) {
        sendBuffer.enqueue(
          input as MailSendInput,
          sendDelayMs,
          draftToPurge !== undefined ? { purgeDraftId: draftToPurge } : undefined,
        );
      } else {
        await sendHook.commit(
          input,
          sendPreviewHash !== null ? { previewHashHex: sendPreviewHash } : {},
        );
        if (draftToPurge !== undefined) {
          // Best-effort. If the purge fails, the send still
          // succeeded — the user just sees the leftover draft and
          // can delete it manually.
          try {
            await invoker.invoke('mail.purge', { emailIds: [draftToPurge] });
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[iarsma] failed to purge draft after send:', e);
          }
        }
      }
      // Clear the draft ref so a re-opened Compose doesn't try to
      // touch the now-deleted draft again.
      lastDraftIdRef.current = null;
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
    sendBuffer,
    sendDelayMs,
    onClose,
  ]);

  // U-10 — when the user has opted to skip the review dialog, a Send
  // click still runs the dry-run preview (so the action-log keeps its
  // provenance hash), but we auto-confirm instead of showing the modal.
  useEffect(() => {
    if (sendPreview !== null && skipSendReview) {
      void onPreviewConfirm();
    }
  }, [sendPreview, skipSendReview, onPreviewConfirm]);

  // Discard draft (PR 5.5): if the user saved a draft at any point
  // during this session, delete it via mail.delete; then close. If
  // nothing was ever saved, the destructive button is hidden so the
  // user can't "discard" something that doesn't exist on the server.
  const hasSavedDraft = lastDraftIdRef.current !== null;
  const onDiscard = useCallback(() => {
    const id = lastDraftIdRef.current;
    if (id === null) {
      onClose();
      return;
    }
    void (async () => {
      try {
        await invoker.invoke('mail.delete', { emailIds: [id] });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[iarsma] discard draft (mail.delete) failed:', e);
      } finally {
        onClose();
      }
    })();
  }, [invoker, onClose]);

  const title = prefill.inReplyTo !== undefined ? 'Reply' : 'New message';
  const sendDisabled =
    !hasAtLeastOneRecipient ||
    hasRecipientErrors ||
    sentMailboxId === null ||
    selectedIdentity === null ||
    uploadsInFlight > 0;

  // PR 47 / CoWork #4 — flush any pending debounced save before
  // the modal closes. Without this, typing "hi" then immediately
  // clicking X / pressing Escape leaves the 500ms timer dangling
  // and the draft is silently discarded.
  const handleClose = useCallback((): void => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    void doSaveDraftRef.current().finally(() => onClose());
  }, [onClose]);

  return (
    <>
      <Dialog
        open
        onClose={handleClose}
        title={title}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            {hasSavedDraft ? (
              <Button variant="destructive" onClick={onDiscard}>
                Discard draft
              </Button>
            ) : null}
            <Button
              variant="primary"
              type="submit"
              form={COMPOSE_FORM_ID}
              disabled={sendDisabled}
            >
              {uploadsInFlight > 0 ? 'Uploading…' : 'Send…'}
            </Button>
          </>
        }
      >
        <div className={styles['composeBody']}>
          <form id={COMPOSE_FORM_ID} onSubmit={onSendClick}>
            <div className={styles['fields']}>
              <FieldRow label="From" htmlFor="compose-identity">
                {identities.length === 0 ? (
                  <output className={styles['fieldOutput']}>
                    {identityList.isLoading
                      ? 'Loading identities…'
                      : 'No sending identities configured on the server.'}
                  </output>
                ) : identities.length === 1 ? (
                  <output className={styles['fieldOutput']}>
                    {formatIdentityLabel(identities[0]!)}
                  </output>
                ) : (
                  <select
                    id="compose-identity"
                    value={selectedIdentityId ?? ''}
                    onChange={(e) => setSelectedIdentityId(e.target.value)}
                    className={styles['fieldInput']}
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
                <RecipientField
                  id="compose-to"
                  recentRecipients={recentRecipients}
                  value={toText}
                  onChange={setToText}
                  onBlur={() => { setToBlurred(true); triggerDebouncedSave(); }}
                  ariaInvalid={toBlurred && parsedTo.errors.length > 0}
                  ariaDescribedBy={
                    toBlurred && parsedTo.errors.length > 0
                      ? 'compose-to-errors' : undefined
                  }
                  placeholder="alice@example.net, Bob <bob@example.net>"
                  className={styles['fieldInput']}
                />
              </FieldRow>
              {toBlurred && parsedTo.errors.length > 0 ? (
                <p
                  id="compose-to-errors"
                  role="alert"
                  className={styles['fieldError']}
                >
                  Invalid recipient(s): {parsedTo.errors.join(', ')}
                </p>
              ) : null}
              {!ccBccVisible ? (
                <div className={styles['ccBccToggleRow']}>
                  <button
                    type="button"
                    className={styles['ccBccToggle']}
                    onClick={() => setCcBccVisible(true)}
                  >
                    Cc/Bcc
                  </button>
                </div>
              ) : null}
              {ccBccVisible ? (
                <>
              <FieldRow label="Cc" htmlFor="compose-cc">
                <RecipientField
                  id="compose-cc"
                  recentRecipients={recentRecipients}
                  value={ccText}
                  onChange={setCcText}
                  onBlur={() => { setCcBlurred(true); triggerDebouncedSave(); }}
                  ariaInvalid={ccBlurred && parsedCc.errors.length > 0}
                  className={styles['fieldInput']}
                />
              </FieldRow>
              {ccBlurred && parsedCc.errors.length > 0 ? (
                <p role="alert" className={styles['fieldError']}>
                  Invalid recipient(s): {parsedCc.errors.join(', ')}
                </p>
              ) : null}
              <FieldRow label="Bcc" htmlFor="compose-bcc">
                <RecipientField
                  id="compose-bcc"
                  recentRecipients={recentRecipients}
                  value={bccText}
                  onChange={setBccText}
                  onBlur={() => { setBccBlurred(true); triggerDebouncedSave(); }}
                  ariaInvalid={bccBlurred && parsedBcc.errors.length > 0}
                  className={styles['fieldInput']}
                />
              </FieldRow>
              {bccBlurred && parsedBcc.errors.length > 0 ? (
                <p role="alert" className={styles['fieldError']}>
                  Invalid recipient(s): {parsedBcc.errors.join(', ')}
                </p>
              ) : null}
                </>
              ) : null}
              <FieldRow label="Subject" htmlFor="compose-subject">
                <input
                  id="compose-subject"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  onBlur={triggerDebouncedSave}
                  className={styles['fieldInput']}
                />
              </FieldRow>
            </div>
            <ComposerToolbar editor={editor} />
            <div className={styles['bodyWrapper']} onBlur={triggerDebouncedSave}>
              <Composer
                label="Message body"
                value={bodyHtml}
                onChange={setBodyHtml}
                onEditorReady={setEditor}
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
              <div style={{ margin: 'var(--space-md) var(--space-lg) 0' }}>
                <Notice variant="error">Draft save failed: {draftError}</Notice>
              </div>
            ) : null}
            {sendError !== null ? (
              <div style={{ margin: 'var(--space-md) var(--space-lg) 0' }}>
                <Notice variant="error">Send failed: {sendError}</Notice>
              </div>
            ) : null}
          </form>
        </div>
      </Dialog>
      {sendPreview !== null && !skipSendReview ? (
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
    <div className={styles['field']}>
      <label htmlFor={props.htmlFor} className={styles['fieldLabel']}>
        {props.label}
      </label>
      {props.children}
    </div>
  );
}

function SendPreviewModal(props: {
  readonly preview: MailSendPreview;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const { preview, onCancel, onConfirm } = props;
  const setSkipSendReview = useSetAtom(skipSendReviewAtom);
  const details: ReadonlyArray<{ label: string; value: React.ReactNode }> = [
    { label: 'To', value: preview.recipients.to.map((a) => a.email).join(', ') },
    ...(preview.recipients.cc !== undefined && preview.recipients.cc.length > 0
      ? [{ label: 'Cc', value: preview.recipients.cc.map((a) => a.email).join(', ') }]
      : []),
    ...(preview.recipients.bcc !== undefined && preview.recipients.bcc.length > 0
      ? [{ label: 'Bcc', value: preview.recipients.bcc.map((a) => a.email).join(', ') }]
      : []),
    { label: 'Subject', value: preview.subject },
    ...(preview.attachmentCount > 0
      ? [
          {
            label: 'Attachments',
            value: `${preview.attachmentCount} file${preview.attachmentCount === 1 ? '' : 's'}`,
          },
        ]
      : []),
    { label: 'Send time', value: preview.estimatedSendTime },
    { label: 'Size', value: `${preview.estimatedSize} B` },
  ];
  return (
    <Dialog
      open
      onClose={onCancel}
      title="Send this message?"
      footer={
        <>
          <label className={styles['skipReviewLabel']}>
            <input
              type="checkbox"
              onChange={(e) => setSkipSendReview(e.target.checked)}
            />
            Don&apos;t ask again
          </label>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            Send
          </Button>
        </>
      }
    >
      <PreviewCard
        inDialog
        details={details}
        body={
          <p
            data-testid="send-preview-body"
            style={{
              margin: 0,
              padding: 'var(--space-sm) var(--space-md)',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              whiteSpace: 'pre-wrap',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-1)',
            }}
          >
            {preview.bodyPreview === '' ? '(empty body)' : preview.bodyPreview}
          </p>
        }
      />
    </Dialog>
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
    <section aria-label="Attachments" className={styles['attachSection']}>
      <div className={styles['attachHead']}>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => inputRef.current?.click()}
        >
          Attach
        </Button>
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
          className={styles['attachFileInput']}
        />
        {uploadsInFlight > 0 ? (
          <output className={styles['attachSize']}>
            Uploading {uploadsInFlight} file{uploadsInFlight === 1 ? '' : 's'}…
          </output>
        ) : attachments.length > 0 ? (
          <output className={styles['attachSize']}>
            {attachments.length} attached
          </output>
        ) : null}
        {/* Reserved slot for the image-resize component (Phase 5).
            Today's flow is "drop file → upload at full size" — that's
            fine for 2-3 MB phone photos but punishing for 12+ MB
            screenshots. The slot will land an inline resize affordance
            (downscale to N px or X% quality) before the upload fires. */}
      </div>
      {error !== null ? (
        <p role="alert" className={styles['fieldError']}>
          {error}
        </p>
      ) : null}
      {attachments.length > 0 ? (
        <ul className={styles['attachChips']}>
          {attachments.map((a) => (
            <li key={a.blobId} className={styles['attachChip']}>
              <span className={styles['attachChipName']}>{a.name}</span>
              <span className={styles['attachChipSize']}>
                {formatBytes(a.size)}
              </span>
              <button
                type="button"
                onClick={() => onRemove(a.blobId)}
                aria-label={`Remove ${a.name}`}
                className={styles['attachChipRemove']}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <line x1="5" y1="5" x2="19" y2="19" />
                  <line x1="19" y1="5" x2="5" y2="19" />
                </svg>
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
