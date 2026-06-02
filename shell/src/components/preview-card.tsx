/**
 * PreviewCard — propose/preview/approve/commit surface (§8.6).
 *
 * One reusable component for: Compose's send-preview modal (human
 * flow) and the Approvals queue cards (agent flow). The brief frames
 * preview-before-commit as a UI primitive; this component makes it
 * one consistent visual treatment instead of three divergent ad-hoc
 * modals.
 *
 * Composition: header (avatar + title + badges + meta) → body
 * (details + free-form block + raw disclosure) → footer (primary /
 * secondary buttons, or a status pill for settled approvals).
 * Consumers control width / layout by placing the card inside their
 * own container.
 */

import { useState, type ReactNode } from 'react';
import { Button } from './button.js';
import { colorFor, initialsFor, type SenderKind } from '../runtime/sender-color.js';
import styles from './preview-card.module.css';

export type PreviewCardAction = {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
};

export type PreviewCardProps = {
  /** Title — e.g. "Send this message?" or a tool name. Optional so
   *  callers wrapping the card in a Dialog (which already has a title)
   *  can omit it and avoid the duplicate. */
  readonly title?: string;
  /** Optional actor proposing the action (agent / contact / system).
   *  Renders as avatar + name inline with the title. */
  readonly actor?: {
    readonly name: string;
    readonly kind?: SenderKind;
    /** Override the color-hash seed (default is `name`). Used when the
     *  caller has an email address that's a more stable identifier. */
    readonly seed?: string;
  };
  /** Inline badges next to the title (tool names, capability scopes). */
  readonly badges?: readonly string[];
  /** Metadata text, right-aligned in the header (relative time, etc.). */
  readonly meta?: string;
  /** Labeled detail rows rendered as a 2-column definition list. */
  readonly details?: readonly { readonly label: string; readonly value: ReactNode }[];
  /** Free-form body content rendered below the details (e.g., a diff,
   *  or a body-preview block). */
  readonly body?: ReactNode;
  /** Raw preview payload — rendered in a `Show raw` disclosure for
   *  debugging / inspection. Defaults to closed. */
  readonly rawPreview?: unknown;
  /** Primary footer action (Send, Approve, etc.). When `status` is
   *  set to 'approved' or 'denied', actions are hidden in favor of
   *  the status pill. */
  readonly primary?: PreviewCardAction & {
    readonly intent?: 'primary' | 'destructive';
  };
  /** Secondary footer action (Cancel, Deny, etc.). */
  readonly secondary?: PreviewCardAction & {
    readonly intent?: 'secondary' | 'destructive';
  };
  /** Approval lifecycle state. 'pending' (default) renders the action
   *  buttons; 'approved' / 'denied' render a status pill. */
  readonly status?: 'pending' | 'approved' | 'denied';
  /** When the card is rendered inside a Dialog body, drop the inner
   *  chrome (border, background, shadow) so the Dialog's own surface
   *  carries the visual treatment. */
  readonly inDialog?: boolean;
  /** Optional aria-label override for the outer container; defaults
   *  to the title. */
  readonly ariaLabel?: string;
};

export function PreviewCard({
  title,
  actor,
  badges,
  meta,
  details,
  body,
  rawPreview,
  primary,
  secondary,
  status = 'pending',
  inDialog = false,
  ariaLabel,
}: PreviewCardProps) {
  const [rawOpen, setRawOpen] = useState(false);

  const showActions = status === 'pending' && (primary !== undefined || secondary !== undefined);
  const showStatus = status === 'approved' || status === 'denied';

  const containerClass = inDialog
    ? `${styles['card']} ${styles['cardInDialog']}`
    : styles['card'];

  const hasHeader =
    title !== undefined ||
    actor !== undefined ||
    (badges !== undefined && badges.length > 0) ||
    meta !== undefined;
  const effectiveLabel = ariaLabel ?? title ?? 'Preview';

  return (
    <section
      role="group"
      aria-label={effectiveLabel}
      className={containerClass}
    >
      {hasHeader ? (
        <header className={styles['header']}>
          {actor !== undefined ? (
            <span
              className={styles['avatar']}
              style={{ background: colorFor(actor.seed ?? actor.name, actor.kind ?? 'human') }}
              aria-hidden="true"
            >
              {initialsFor(actor.name, actor.seed ?? '')}
            </span>
          ) : null}
          {title !== undefined || actor !== undefined ? (
            <h3
              className={`${styles['title']} ${actor !== undefined ? styles['titleWithActor'] : ''}`}
            >
              {actor !== undefined && title !== undefined ? (
                <>
                  <span className={styles['actorName']}>{actor.name}</span>
                  {' — '}
                  {title}
                </>
              ) : actor !== undefined ? (
                <span className={styles['actorName']}>{actor.name}</span>
              ) : (
                title
              )}
            </h3>
          ) : null}
          {badges !== undefined && badges.length > 0 ? (
            <span className={styles['badges']} aria-label="Tags">
              {badges.map((b) => (
                <span key={b} className={styles['badge']}>
                  {b}
                </span>
              ))}
            </span>
          ) : null}
          {meta !== undefined ? <span className={styles['meta']}>{meta}</span> : null}
        </header>
      ) : null}

      {details !== undefined && details.length > 0 ? (
        <dl className={styles['details']}>
          {details.map((d, i) => (
            // Use the label as the key when stable; index fallback covers
            // the (rare) case of duplicate labels.
            <Detail key={`${d.label}-${i}`} label={d.label} value={d.value} />
          ))}
        </dl>
      ) : null}

      {body !== undefined ? <div>{body}</div> : null}

      {rawPreview !== undefined ? (
        <div className={styles['rawDisclosure']}>
          <button
            type="button"
            className={styles['rawToggle']}
            onClick={() => setRawOpen((v) => !v)}
            aria-expanded={rawOpen}
          >
            {rawOpen ? 'Hide raw preview' : 'Show raw preview'}
          </button>
          {rawOpen ? (
            <pre className={styles['rawPre']}>{safeStringify(rawPreview)}</pre>
          ) : null}
        </div>
      ) : null}

      <footer className={styles['footer']}>
        {showStatus ? (
          <span
            className={`${styles['statusPill']} ${
              status === 'approved'
                ? styles['statusPillApproved']
                : styles['statusPillDenied']
            }`}
          >
            {status === 'approved' ? 'Approved' : 'Denied'}
          </span>
        ) : null}
        {showActions ? (
          <>
            {secondary !== undefined ? (
              <Button
                variant={secondary.intent === 'destructive' ? 'destructive' : 'secondary'}
                onClick={secondary.onClick}
                {...(secondary.disabled !== undefined ? { disabled: secondary.disabled } : {})}
              >
                {secondary.label}
              </Button>
            ) : null}
            {primary !== undefined ? (
              <Button
                variant={primary.intent === 'destructive' ? 'destructive' : 'primary'}
                onClick={primary.onClick}
                {...(primary.disabled !== undefined ? { disabled: primary.disabled } : {})}
              >
                {primary.label}
              </Button>
            ) : null}
          </>
        ) : null}
      </footer>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt className={styles['detailLabel']}>{label}</dt>
      <dd className={styles['detailValue']}>{value}</dd>
    </>
  );
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
