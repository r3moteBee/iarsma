/**
 * AgentSettingsView — settings surface with a left sub-nav + content panel
 * (§8.11). Sections:
 *   • Appearance  — theme + accent + density (mirrors sidebar footer)
 *   • Agent tokens — issue + table of active tokens
 *   • Files       — GitHub connection (FilesSettingsPanel)
 *   • Account     — signed-in email + sign out
 *
 * Previously a flat scroll containing all three; the sub-nav gives
 * each surface a discoverable home and matches the navigation
 * affordance density of the rest of the shell.
 */

import { useAtom, useAtomValue } from 'jotai';
import { useEffect, useState } from 'react';
import { agentContextAtom } from '../auth-state.js';
import { AccentPicker } from '../components/accent-picker.js';
import { Button } from '../components/button.js';
import { DensitySelector } from '../components/density-selector.js';
import { Input } from '../components/input.js';
import { Notice } from '../components/notice.js';
import { useInvoker } from '../runtime/invoker.js';
import type { Identity, VacationResponse } from '../runtime/jmap-client.js';
import {
  DEFAULT_SEND_DELAY_MS,
  MAX_SEND_DELAY_MS,
  sendDelayMsAtom,
} from '../runtime/send-delay-state.js';
import { skipSendReviewAtom } from '../runtime/skip-send-review-state.js';
import { themePreferenceAtom, type ThemePreference } from '../runtime/theme.js';
import type { IssuedToken } from '../runtime/agent-token-issuer.js';
import { FilesSettingsPanel } from './files-settings-panel.js';
import type { FilesSettingsPanelProps } from './files-settings-panel.js';
import styles from './agent-settings-view.module.css';

// ── Scope definitions ──────────────────────────────────────────────

const ALL_SCOPES = [
  'mail:read',
  'mail:draft',
  'mail:send',
  'mail:modify',
  'mail:delete',
  'mail:mailbox',
] as const;

// ── Lifetime options (label → seconds) ─────────────────────────────

const LIFETIME_OPTIONS: readonly { readonly label: string; readonly seconds: number }[] = [
  { label: '1 hour', seconds: 3600 },
  { label: '1 day', seconds: 86400 },
  { label: '7 days', seconds: 604800 },
  { label: '30 days', seconds: 2592000 },
  { label: '90 days', seconds: 7776000 },
];

// ── Props ──────────────────────────────────────────────────────────

type AgentSettingsViewProps = {
  /** Optional GitHub Files integration settings. */
  readonly files?: FilesSettingsPanelProps;
  /** Account info — signed-in email + sign-out handler. */
  readonly userName?: string;
  readonly onSignOut?: () => void;
};

type SectionId =
  | 'appearance'
  | 'sending'
  | 'signatures'
  | 'vacation'
  | 'files'
  | 'account';

type SectionDef = {
  readonly id: SectionId;
  readonly label: string;
};

// PR 40 — `tokens` moved to the Agents top-level view. The form,
// docs panel, and table all live there now; Settings only carries
// settings that don't have their own surface.
const SECTIONS: readonly SectionDef[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'sending', label: 'Sending' },
  { id: 'signatures', label: 'Signatures' },
  { id: 'vacation', label: 'Vacation responder' },
  { id: 'files', label: 'Files' },
  { id: 'account', label: 'Account' },
];

// ── Component ──────────────────────────────────────────────────────

export function AgentSettingsView({
  files,
  userName,
  onSignOut,
}: AgentSettingsViewProps) {
  const [section, setSection] = useState<SectionId>('appearance');

  return (
    <section aria-labelledby="agent-settings-heading" className={styles['layout']}>
      <h2 id="agent-settings-heading" style={visuallyHidden}>
        Settings
      </h2>
      <nav className={styles['subnav']} aria-label="Settings sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`${styles['tab']} ${section === s.id ? styles['tabActive'] : ''}`}
            onClick={() => setSection(s.id)}
            aria-current={section === s.id ? 'page' : undefined}
            data-testid={`settings-tab-${s.id}`}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <div className={styles['content']}>
        {section === 'appearance' ? <AppearanceSection /> : null}
        {section === 'sending' ? <SendingSection /> : null}
        {section === 'signatures' ? <SignaturesSection /> : null}
        {section === 'vacation' ? <VacationSection /> : null}
        {section === 'files' ? (
          files !== undefined ? (
            <FilesSection {...files} />
          ) : (
            <p className={styles['sectionDescription']}>
              Files integration is not configured for this deployment.
            </p>
          )
        ) : null}
        {section === 'account' ? (
          <AccountSection
            {...(userName !== undefined ? { userName } : {})}
            {...(onSignOut !== undefined ? { onSignOut } : {})}
          />
        ) : null}
      </div>
    </section>
  );
}

// ── Appearance section ─────────────────────────────────────────────

function AppearanceSection() {
  const [theme, setTheme] = useAtom(themePreferenceAtom);
  return (
    <section aria-labelledby="appearance-heading">
      <h3 id="appearance-heading" className={styles['sectionHeading']}>
        Appearance
      </h3>
      <p className={styles['sectionDescription']}>
        Theme, accent, and density. The same controls live in the sidebar footer; changing them here updates everywhere immediately.
      </p>
      <div className={styles['appearanceRow']}>
        <span className={styles['appearanceLabel']}>Theme</span>
        <ThemeToggleInline theme={theme} onChange={setTheme} />
      </div>
      <div className={styles['appearanceRow']}>
        <span className={styles['appearanceLabel']}>Accent</span>
        <AccentPicker />
      </div>
      <div className={styles['appearanceRow']}>
        <span className={styles['appearanceLabel']}>Density</span>
        <DensitySelector />
      </div>
    </section>
  );
}

function ThemeToggleInline({
  theme,
  onChange,
}: {
  readonly theme: ThemePreference;
  readonly onChange: (next: ThemePreference) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Theme preference" style={{ display: 'inline-flex', gap: 4 }}>
      {(['light', 'dark', 'system'] as const).map((opt) => (
        <Button
          key={opt}
          variant={theme === opt ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => onChange(opt)}
          aria-label={`${opt} theme`}
        >
          {opt.charAt(0).toUpperCase() + opt.slice(1)}
        </Button>
      ))}
    </div>
  );
}

// ── Sending section ────────────────────────────────────────────────

function SendingSection() {
  const [delayMs, setDelayMs] = useAtom(sendDelayMsAtom);
  const [skipReview, setSkipReview] = useAtom(skipSendReviewAtom);
  const seconds = Math.round(delayMs / 1000);
  return (
    <section aria-labelledby="sending-heading">
      <h3 id="sending-heading" className={styles['sectionHeading']}>
        Sending
      </h3>
      <p className={styles['sectionDescription']}>
        Buffers outgoing mail locally for a short window so you can undo
        a send before it actually leaves. Setting this to 0 sends
        immediately — no undo. Max {MAX_SEND_DELAY_MS / 1000}s.
      </p>
      <div className={styles['appearanceRow']}>
        <label
          className={styles['appearanceLabel']}
          htmlFor="send-delay-input"
        >
          Delay
        </label>
        <Input
          id="send-delay-input"
          type="text"
          value={String(seconds)}
          onChange={(v) => {
            const n = Number.parseInt(v, 10);
            if (Number.isNaN(n)) {
              setDelayMs(DEFAULT_SEND_DELAY_MS);
              return;
            }
            setDelayMs(n * 1000);
          }}
        />
        <span className={styles['sectionDescription']} style={{ margin: 0 }}>
          seconds
        </span>
      </div>
      <div className={styles['appearanceRow']}>
        <label
          className={styles['appearanceLabel']}
          htmlFor="confirm-send-input"
        >
          Confirm before sending
        </label>
        <input
          id="confirm-send-input"
          type="checkbox"
          checked={!skipReview}
          onChange={(e) => setSkipReview(!e.target.checked)}
        />
      </div>
      <p className={styles['sectionDescription']}>
        Shows a review dialog (recipients, subject, preview) before each
        message you send. Turn off to send straight to the undo window.
      </p>
    </section>
  );
}

// ── Signatures section (PR 33) ────────────────────────────────────

function SignaturesSection() {
  const invoker = useInvoker();
  const [identities, setIdentities] = useState<readonly Identity[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Load identities on mount. JMAP Identity/get returns every
  // identity the account is permitted to see; iarsma puts the
  // signature against the per-identity record so a user with
  // multiple sending addresses can vary their sign-off.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const result = (await invoker.invoke<unknown, { identities: Identity[] }>(
          'identity.list',
          {},
        )) as { identities: Identity[] };
        if (cancelled) return;
        const list = result.identities ?? [];
        setIdentities(list);
        const first = list[0];
        if (first !== undefined) {
          setSelectedId(first.id);
          setDraft(first.textSignature ?? '');
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoker]);

  // When the user picks a different identity, reset the draft to
  // that identity's stored signature.
  const onPickIdentity = (id: string): void => {
    setSelectedId(id);
    const match = identities.find((i) => i.id === id);
    setDraft(match?.textSignature ?? '');
    setSavedAt(null);
  };

  const selected = identities.find((i) => i.id === selectedId) ?? null;
  const isDirty = selected !== null && draft !== (selected.textSignature ?? '');

  const onSave = async (): Promise<void> => {
    if (selected === null) return;
    setSaving(true);
    setError(null);
    try {
      // Empty string → explicit null so the server clears the field.
      const trimmed = draft.trimEnd();
      await invoker.invoke('identity.update', {
        identityId: selected.id,
        patch: { textSignature: trimmed === '' ? null : trimmed },
      });
      // Mirror locally so the dirty check stops firing without
      // waiting for the identity.list cache to refresh.
      setIdentities((prev) =>
        prev.map((i) => {
          if (i.id !== selected.id) return i;
          // Drop textSignature entirely when cleared so the dirty
          // check (draft === '' vs textSignature ?? '') is correct.
          const { textSignature: _omit, ...rest } = i;
          return trimmed === ''
            ? rest
            : { ...rest, textSignature: trimmed };
        }),
      );
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // Clear the "Saved" status after 3s.
  useEffect(() => {
    if (savedAt === null) return;
    const handle = window.setTimeout(() => setSavedAt(null), 3000);
    return () => window.clearTimeout(handle);
  }, [savedAt]);

  return (
    <section aria-labelledby="signatures-heading">
      <h3 id="signatures-heading" className={styles['sectionHeading']}>
        Signatures
      </h3>
      <p className={styles['sectionDescription']}>
        Per-identity sign-off text. New messages composed under an
        identity auto-prepend the trimmed signature; existing drafts
        and replies are left as-is so saved content is never
        clobbered.
      </p>
      {loading ? <p className={styles['sectionDescription']}>Loading…</p> : null}
      {!loading && identities.length === 0 ? (
        <Notice variant="error">
          No identities configured on this account. Ask the operator
          to add one before setting a signature.
        </Notice>
      ) : null}
      {!loading && identities.length > 0 ? (
        <>
          {identities.length > 1 ? (
            <div className={styles['appearanceRow']}>
              <label
                className={styles['appearanceLabel']}
                htmlFor="signature-identity"
              >
                Identity
              </label>
              <select
                id="signature-identity"
                value={selectedId ?? ''}
                onChange={(e) => onPickIdentity(e.target.value)}
                style={{
                  font: 'inherit',
                  fontSize: 'var(--text-md)',
                  padding: '6px 10px',
                  background: 'var(--surface-2)',
                  color: 'var(--text-1)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {identities.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name !== '' ? `${i.name} <${i.email}>` : i.email}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className={styles['sectionDescription']}>
              For <strong>{selected?.email}</strong>
            </p>
          )}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              marginBottom: 'var(--space-md)',
            }}
          >
            <label
              htmlFor="signature-body"
              className={styles['appearanceLabel']}
              style={{ width: 'auto' }}
            >
              Signature
            </label>
            <textarea
              id="signature-body"
              value={draft}
              placeholder={`-- \nJane Doe\nVP of Things\nexample.com`}
              onChange={(e) => setDraft(e.target.value)}
              rows={8}
              style={{
                width: '100%',
                font: 'inherit',
                fontSize: 'var(--text-md)',
                padding: '8px 10px',
                background: 'var(--surface-2)',
                color: 'var(--text-1)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                resize: 'vertical',
              }}
            />
          </div>
          {error !== null ? <Notice variant="error">{error}</Notice> : null}
          {savedAt !== null ? <Notice variant="success">Saved.</Notice> : null}
          <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
            <Button
              variant="primary"
              onClick={() => {
                void onSave();
              }}
              disabled={saving || !isDirty}
            >
              {saving ? 'Saving…' : 'Save signature'}
            </Button>
            {isDirty ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setDraft(selected?.textSignature ?? '');
                  setSavedAt(null);
                }}
                disabled={saving}
              >
                Revert
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

// ── Vacation responder section (PR 32) ────────────────────────────

function VacationSection() {
  const invoker = useInvoker();
  const [isEnabled, setIsEnabled] = useState(false);
  const [subject, setSubject] = useState('');
  const [textBody, setTextBody] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Hydrate from the server on mount. If the account has never
  // configured a vacation responder, the invoker returns the
  // singleton with isEnabled:false and we render the empty form.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const v = (await invoker.invoke<unknown, VacationResponse>(
          'vacation.get',
          {},
        )) as VacationResponse;
        if (cancelled) return;
        setIsEnabled(v.isEnabled);
        setSubject(v.subject ?? '');
        setTextBody(v.textBody ?? '');
        // JMAP returns ISO 8601 datetimes; the <input type="date">
        // wants YYYY-MM-DD. Strip the time component.
        setFromDate(toDateInputValue(v.fromDate));
        setToDate(toDateInputValue(v.toDate));
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoker]);

  const onSave = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      // Build a payload only including the fields the user actually
      // filled in — empty strings → server clears the field.
      const trimmedSubject = subject.trim();
      const trimmedBody = textBody.trim();
      await invoker.invoke('vacation.set', {
        isEnabled,
        ...(trimmedSubject !== '' ? { subject: trimmedSubject } : {}),
        ...(trimmedBody !== '' ? { textBody: trimmedBody } : {}),
        // Promote YYYY-MM-DD to YYYY-MM-DDT00:00:00Z so JMAP accepts it.
        ...(fromDate !== '' ? { fromDate: `${fromDate}T00:00:00Z` } : {}),
        ...(toDate !== '' ? { toDate: `${toDate}T23:59:59Z` } : {}),
      });
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // Clear the "Saved" status after 3s so the surface doesn't lie
  // about state if the user comes back later.
  useEffect(() => {
    if (savedAt === null) return;
    const handle = window.setTimeout(() => setSavedAt(null), 3000);
    return () => window.clearTimeout(handle);
  }, [savedAt]);

  const canSave =
    !saving && !loading && (!isEnabled || subject.trim() !== '');

  return (
    <section aria-labelledby="vacation-heading">
      <h3 id="vacation-heading" className={styles['sectionHeading']}>
        Vacation responder
      </h3>
      <p className={styles['sectionDescription']}>
        When enabled, the server auto-replies to incoming mail with the
        subject and body below. Optional dates let you schedule the
        responder in advance — leave blank to start now / never
        auto-expire.
      </p>
      {loading ? <p className={styles['sectionDescription']}>Loading…</p> : null}
      {!loading ? (
        <>
          <div className={styles['appearanceRow']}>
            <span className={styles['appearanceLabel']}>Status</span>
            <label
              style={{
                display: 'inline-flex',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <input
                type="checkbox"
                checked={isEnabled}
                onChange={(e) => setIsEnabled(e.target.checked)}
                aria-label="Enable vacation responder"
              />
              <span>
                {isEnabled
                  ? 'On — incoming mail will receive an auto-reply'
                  : 'Off'}
              </span>
            </label>
          </div>
          <div className={styles['appearanceRow']}>
            <label
              className={styles['appearanceLabel']}
              htmlFor="vacation-subject"
            >
              Subject
            </label>
            <Input
              id="vacation-subject"
              type="text"
              value={subject}
              placeholder="Out of office"
              onChange={setSubject}
            />
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              marginBottom: 'var(--space-md)',
            }}
          >
            <label
              htmlFor="vacation-body"
              className={styles['appearanceLabel']}
              style={{ width: 'auto' }}
            >
              Message
            </label>
            <textarea
              id="vacation-body"
              value={textBody}
              placeholder="I'll be back next week."
              onChange={(e) => setTextBody(e.target.value)}
              rows={6}
              style={{
                width: '100%',
                font: 'inherit',
                fontSize: 'var(--text-md)',
                padding: '8px 10px',
                background: 'var(--surface-2)',
                color: 'var(--text-1)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                resize: 'vertical',
              }}
            />
          </div>
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-md)',
              marginBottom: 'var(--space-md)',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label
                htmlFor="vacation-from"
                className={styles['appearanceLabel']}
                style={{ width: 'auto' }}
              >
                Start date (optional)
              </label>
              <input
                id="vacation-from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                style={{
                  font: 'inherit',
                  fontSize: 'var(--text-md)',
                  padding: '6px 10px',
                  background: 'var(--surface-2)',
                  color: 'var(--text-1)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label
                htmlFor="vacation-to"
                className={styles['appearanceLabel']}
                style={{ width: 'auto' }}
              >
                End date (optional)
              </label>
              <input
                id="vacation-to"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                style={{
                  font: 'inherit',
                  fontSize: 'var(--text-md)',
                  padding: '6px 10px',
                  background: 'var(--surface-2)',
                  color: 'var(--text-1)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                }}
              />
            </div>
          </div>
          {error !== null ? <Notice variant="error">{error}</Notice> : null}
          {savedAt !== null ? (
            <Notice variant="success">Saved.</Notice>
          ) : null}
          <div>
            <Button
              variant="primary"
              onClick={() => {
                void onSave();
              }}
              disabled={!canSave}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}

/** Convert a JMAP UTCDate (ISO 8601 with offset or Z) into the
 *  `YYYY-MM-DD` shape that <input type="date"> wants. Returns an
 *  empty string when the input is missing or unparseable. */
function toDateInputValue(iso: string | undefined): string {
  if (iso === undefined) return '';
  // ISO format starts with YYYY-MM-DD; slice off the time.
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m === null ? '' : m[1]!;
}

// ── MCP connection instructions (PR 34) ────────────────────────────

/**
 * Collapsible docs panel that walks the user through deploying the
 * Iarsma MCP server and pointing an agent at it.
 *
 * Architecture: this webmail issues tokens + audits agent calls. The
 * MCP server itself is a separate Node.js process the user (or their
 * operator) runs on a host they control — pantheon box, side
 * container next to Stalwart, etc. The webmail can't know that
 * hostname ahead of time, so the deploy snippet uses the current
 * page's origin for the JMAP base URL (auto-filled) and a labelled
 * `<MCP-HOST>` placeholder for the host the user picks.
 *
 * When the operator HAS set the webmail's VITE_AGENT_CONTEXT_WEBMAIL_MCP_URL
 * (so the shell knows where the running MCP server is), it's shown
 * up front and the user can skip to the connect step.
 *
 * Defaults to closed so the panel doesn't dominate the page for
 * users who already have their agents wired up.
 */
export function McpConnectionDocs() {
  const agentContext = useAtomValue(agentContextAtom);
  const configuredMcpUrl = agentContext?.webmailMcpUrl ?? null;
  // JMAP base = where this webmail is served. The current page's
  // origin works because Stalwart serves both JMAP and webmail from
  // the same host. Fallback for SSR / tests is a placeholder string.
  const jmapBaseUrl =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://<your-stalwart-host>';
  const defaultPort = 8765;
  // The URL agents actually connect to. If the operator already
  // wired one up, use it; otherwise build a labelled placeholder
  // — the user fills in <MCP-HOST> with whatever box ran step 1.
  const mcpUrlForAgent =
    configuredMcpUrl ?? `http://<MCP-HOST>:${defaultPort}/mcp`;

  // The docker-compose recipe at deployment/mcp/ is the supported
  // path. Operator runs it once per Stalwart host; agent tokens are
  // never copied into the server's .env (D-058).
  const composeQuickstart = `# Operator-only — runs once per Stalwart host. The MCP server has
# no shared secret of its own: each agent's own Stalwart API key
# bearer is what authenticates every call.
git clone https://github.com/r3moteBee/iarsma.git
cd iarsma/deployment/mcp
cp .env.example .env
$EDITOR .env   # Set IARSMA_JMAP_BASE_URL — that's it
docker compose up -d
docker compose logs -f iarsma-mcp
# Expect: "Streamable HTTP transport listening on 0.0.0.0:${defaultPort}"
# and:    "Token store: stalwart-session @ ${jmapBaseUrl}"`;

  const envFileContents = `# deployment/mcp/.env — only IARSMA_JMAP_BASE_URL is required.
# No operator credential. The MCP server validates each agent's
# bearer by calling Stalwart's JMAP session endpoint — Stalwart
# is the auth gate, the MCP server is just a proxy.
IARSMA_JMAP_BASE_URL=${jmapBaseUrl}
IARSMA_MCP_HTTP_PORT=${defaultPort}
IARSMA_MCP_HTTP_HOST=0.0.0.0`;

  const curlExample = `TOKEN="<paste-the-secret-shown-when-you-issued-the-token>"
MCP="${mcpUrlForAgent}"

curl -s -X POST "$MCP" \\
  -H "authorization: Bearer $TOKEN" \\
  -H "content-type: application/json" \\
  -H "accept: application/json, text/event-stream" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": { "name": "mailbox.list", "arguments": {} }
  }'`;

  const sdkExample = `import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const transport = new StreamableHTTPClientTransport(
  new URL('${mcpUrlForAgent}'),
  {
    requestInit: {
      headers: {
        authorization: \`Bearer \${process.env.IARSMA_TOKEN}\`,
      },
    },
  },
);

const client = new Client(
  { name: 'my-agent', version: '0.1.0' },
  { capabilities: {} },
);
await client.connect(transport);

// The server reports only the tools your token's scopes permit.
const { tools } = await client.listTools();
console.log(tools.map((t) => t.name));`;

  return (
    <details className={styles['mcpDocs']}>
      <summary>How to connect an MCP agent</summary>
      <div className={styles['mcpDocsBody']}>
        <h4>How this fits together</h4>
        <p>
          This webmail at <CopyableValue value={jmapBaseUrl} />{' '}
          issues <strong>Stalwart API keys</strong> directly into
          Stalwart's server-side key store, then shows them in the
          list below. Agents don't connect here — they connect to a
          separate <strong>MCP server</strong> process that talks to
          Stalwart on each agent's behalf. Every agent call is
          validated against Stalwart by the MCP server using the
          agent's own bearer; revoking a key here locks the agent
          out within seconds. The list works from any device because
          Stalwart owns it, not your browser.
        </p>
        {configuredMcpUrl !== null ? (
          <p>
            This deployment already advertises a running MCP server
            at <CopyableValue value={configuredMcpUrl} /> — skip to{' '}
            <strong>Connect your agent</strong> below.
          </p>
        ) : (
          <p>
            This deployment does not yet advertise a running MCP
            server URL (<code>VITE_AGENT_CONTEXT_WEBMAIL_MCP_URL</code>{' '}
            is unset). The operator section below brings one up.
          </p>
        )}

        <h4>Connect your agent (this is what most users do)</h4>
        <ol>
          <li>
            <strong>Issue a token</strong> using the form below this
            panel. Pick scopes carefully — agents only see the tools
            their token permits, and revoking a token is the only
            kill switch. The secret is shown once.
          </li>
          <li>
            <strong>Point your agent at the MCP server</strong>:{' '}
            <CopyableValue value={mcpUrlForAgent} />
            {configuredMcpUrl === null ? (
              <>
                {' '}— replace <code>&lt;MCP-HOST&gt;</code> with the
                hostname or IP your operator set up.
              </>
            ) : null}
          </li>
          <li>
            <strong>Set the Authorization header</strong> to{' '}
            <code>Bearer &lt;the-secret-from-step-1&gt;</code>.
            That's it — no <code>.env</code> file on the server, no
            operator coordination. The MCP server introspects your
            token against Stalwart and runs each call with your
            mailbox's permissions.
          </li>
        </ol>

        <h4>Sanity check with curl</h4>
        <CodeBlock value={curlExample} />

        <h4>Or use the official MCP SDK</h4>
        <p>
          TypeScript example using{' '}
          <code>@modelcontextprotocol/sdk</code>:
        </p>
        <CodeBlock value={sdkExample} />

        <h4>What the agent can do</h4>
        <p>
          Tool names match the scopes you grant. For example,{' '}
          <code>mail:read</code> exposes <code>mailbox.list</code>,{' '}
          <code>thread.list</code>, <code>thread.get</code>, and{' '}
          <code>thread.search</code>; <code>mail:send</code> adds{' '}
          <code>mail.send</code>; <code>mail:modify</code> adds{' '}
          <code>mail.modify</code> (flag/mark-read/move). Destructive
          tools like <code>mail.send</code> and{' '}
          <code>mail.modify</code> honor a <em>dry-run</em> mode the
          agent should exercise before committing.
        </p>

        <h4>Audit</h4>
        <p>
          Every agent call appears in the{' '}
          <strong>Activity</strong> view with a hash-chain audit
          entry. Each token row below has an <em>Activity</em> link
          that pre-filters Activity by that agent.
        </p>

        <h4>Operator: bring up the MCP server (one-time)</h4>
        <p>
          This is only for the person running the Stalwart host.
          Users issuing tokens don't need any of this. The MCP
          server is multi-tenant: <strong>one instance per Stalwart
          host</strong> serves agents for every mailbox.
        </p>
        <CodeBlock value={composeQuickstart} />
        <p>
          Your <code>.env</code> needs only the Stalwart URL and one
          operator credential — an admin Bearer token Stalwart uses
          to authorize introspection requests. No per-user values
          go here:
        </p>
        <CodeBlock value={envFileContents} />
        <p>
          See <code>deployment/mcp/README.md</code> in the repo for
          updates, reverse-proxy notes, and troubleshooting.
        </p>
      </div>
    </details>
  );
}

/** Inline value with a one-shot Copy affordance. Used for the MCP
 *  URL and the Authorization line. */
function CopyableValue({ value }: { readonly value: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = (): void => {
    if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return;
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <>
      <span className={styles['mcpUrl']}>{value}</span>{' '}
      <button
        type="button"
        className={styles['codeBlockCopy']}
        style={{ position: 'static', marginLeft: 4 }}
        onClick={onCopy}
        aria-label="Copy MCP URL"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </>
  );
}

/** Code block with a Copy button in the top-right corner. */
function CodeBlock({ value }: { readonly value: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = (): void => {
    if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return;
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className={styles['codeBlock']}>
      <pre>{value}</pre>
      <button
        type="button"
        className={styles['codeBlockCopy']}
        onClick={onCopy}
        aria-label="Copy code"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export function IssueTokenForm({
  onIssue,
}: {
  readonly onIssue: (
    name: string,
    scopes: readonly string[],
    lifetimeSec: number,
  ) => Promise<IssuedToken>;
}) {
  const [name, setName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set());
  const [lifetimeSec, setLifetimeSec] = useState(LIFETIME_OPTIONS[0]!.seconds);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [issuedSecret, setIssuedSecret] = useState<IssuedToken | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const canSubmit = name.trim() !== '' && selectedScopes.size > 0 && !isSubmitting;

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      const result = await onIssue(name.trim(), [...selectedScopes], lifetimeSec);
      setIssuedSecret(result);
      setName('');
      setSelectedScopes(new Set());
      setLifetimeSec(LIFETIME_OPTIONS[0]!.seconds);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (issuedSecret === null) return;
    try {
      await navigator.clipboard.writeText(issuedSecret.clientSecret);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
      /* fallback: select text */
    }
  };

  return (
    <section aria-labelledby="issue-token-heading" style={{ marginBottom: 'var(--space-xl)' }}>
      <h4 id="issue-token-heading" style={{ margin: '0 0 var(--space-md)' }}>
        Issue New Token
      </h4>

      {issuedSecret !== null ? (
        <div style={{ marginBottom: 'var(--space-md)' }}>
          <Notice variant="warning" onDismiss={() => setIssuedSecret(null)}>
            <p style={{ margin: '0 0 0.5em' }}>
              <strong>Client Secret:</strong>{' '}
              <code style={{ wordBreak: 'break-all' }}>{issuedSecret.clientSecret}</code>
            </p>
            <Button size="sm" variant="secondary" onClick={handleCopy} aria-label="Copy secret">
              {copyFeedback ? 'Copied!' : 'Copy'}
            </Button>
            <p style={{ margin: '0.5em 0 0', fontSize: '0.9em' }}>
              This secret won't be shown again. Store it securely now.
            </p>
          </Notice>
        </div>
      ) : null}

      <form onSubmit={handleSubmit}>
        <div className={styles['formField']}>
          <Input
            label="Agent Name"
            value={name}
            onChange={setName}
            id="token-name"
            placeholder="e.g. triage-bot"
          />
        </div>

        <fieldset className={styles['scopeFieldset']}>
          <legend>Scopes</legend>
          <div className={styles['scopeChips']}>
            {ALL_SCOPES.map((scope) => {
              const checked = selectedScopes.has(scope);
              return (
                <label
                  key={scope}
                  className={`${styles['scopeChip']} ${checked ? styles['scopeChipChecked'] : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleScope(scope)}
                  />
                  {scope}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className={styles['formField']}>
          <label htmlFor="lifetime-select">Lifetime</label>
          <select
            id="lifetime-select"
            value={lifetimeSec}
            onChange={(e) => setLifetimeSec(Number(e.target.value))}
            className={styles['lifetimeSelect']}
          >
            {LIFETIME_OPTIONS.map((opt) => (
              <option key={opt.seconds} value={opt.seconds}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {isSubmitting ? 'Issuing…' : 'Issue Token'}
        </Button>
      </form>
    </section>
  );
}


// ── Files section ──────────────────────────────────────────────────

function FilesSection(props: FilesSettingsPanelProps) {
  return (
    <section aria-labelledby="files-heading">
      <h3 id="files-heading" className={styles['sectionHeading']}>
        Files
      </h3>
      <p className={styles['sectionDescription']}>
        Connect a GitHub repository so agents and the Files view can read and propose changes against it.
      </p>
      <FilesSettingsPanel {...props} />
    </section>
  );
}

// ── Account section ────────────────────────────────────────────────

function AccountSection({
  userName,
  onSignOut,
}: {
  readonly userName?: string;
  readonly onSignOut?: () => void;
}) {
  return (
    <section aria-labelledby="account-heading">
      <h3 id="account-heading" className={styles['sectionHeading']}>
        Account
      </h3>
      <div className={styles['accountRow']}>
        <span className={styles['accountLabel']}>Signed in as</span>
        <span className={styles['accountValue']}>{userName ?? '—'}</span>
      </div>
      {onSignOut !== undefined ? (
        <div style={{ marginTop: 'var(--space-lg)' }}>
          <Button variant="destructive" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      ) : null}
    </section>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

const visuallyHidden = {
  position: 'absolute' as const,
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap' as const,
  border: 0,
};

