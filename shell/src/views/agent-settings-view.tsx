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

import { useAtom } from 'jotai';
import { useState } from 'react';
import { AccentPicker } from '../components/accent-picker.js';
import { Button } from '../components/button.js';
import { DensitySelector } from '../components/density-selector.js';
import { Dialog } from '../components/dialog.js';
import { Input } from '../components/input.js';
import { Notice } from '../components/notice.js';
import { themePreferenceAtom, type ThemePreference } from '../runtime/theme.js';
import type { AgentTokenInfo, IssuedToken } from '../runtime/agent-token-issuer.js';
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
  readonly tokens: readonly AgentTokenInfo[];
  readonly onIssue: (name: string, scopes: string[], lifetimeSec: number) => Promise<IssuedToken>;
  readonly onRevoke: (tokenId: string) => Promise<void>;
  readonly isLoading?: boolean;
  /** Optional GitHub Files integration settings. */
  readonly files?: FilesSettingsPanelProps;
  /** Account info — signed-in email + sign-out handler. */
  readonly userName?: string;
  readonly onSignOut?: () => void;
};

type SectionId = 'appearance' | 'tokens' | 'files' | 'account';

type SectionDef = {
  readonly id: SectionId;
  readonly label: string;
};

const SECTIONS: readonly SectionDef[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'tokens', label: 'Agent tokens' },
  { id: 'files', label: 'Files' },
  { id: 'account', label: 'Account' },
];

// ── Component ──────────────────────────────────────────────────────

export function AgentSettingsView({
  tokens,
  onIssue,
  onRevoke,
  isLoading,
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
        {section === 'tokens' ? (
          <TokensSection
            tokens={tokens}
            onIssue={onIssue}
            onRevoke={onRevoke}
            {...(isLoading !== undefined ? { isLoading } : {})}
          />
        ) : null}
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

// ── Tokens section ─────────────────────────────────────────────────

function TokensSection({
  tokens,
  onIssue,
  onRevoke,
  isLoading,
}: {
  readonly tokens: readonly AgentTokenInfo[];
  readonly onIssue: AgentSettingsViewProps['onIssue'];
  readonly onRevoke: AgentSettingsViewProps['onRevoke'];
  readonly isLoading?: boolean;
}) {
  return (
    <section aria-labelledby="tokens-heading">
      <h3 id="tokens-heading" className={styles['sectionHeading']}>
        Agent tokens
      </h3>
      <p className={styles['sectionDescription']}>
        Issue capability-scoped tokens for agents to access this account. Each token can be revoked at any time.
      </p>
      {isLoading === true ? <p>Loading tokens…</p> : null}
      <IssueTokenForm onIssue={onIssue} />
      <TokenTable tokens={tokens} onRevoke={onRevoke} />
    </section>
  );
}

function IssueTokenForm({
  onIssue,
}: {
  readonly onIssue: AgentSettingsViewProps['onIssue'];
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

function TokenTable({
  tokens,
  onRevoke,
}: {
  readonly tokens: readonly AgentTokenInfo[];
  readonly onRevoke: (tokenId: string) => Promise<void>;
}) {
  return (
    <section aria-labelledby="active-tokens-heading">
      <h4 id="active-tokens-heading" style={{ margin: '0 0 var(--space-md)' }}>
        Active Tokens
      </h4>
      <table className={styles['tokenTable']}>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Scopes</th>
            <th scope="col">Issued</th>
            <th scope="col">Expires</th>
            <th scope="col">Status</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((token) => (
            <TokenRow key={token.tokenId} token={token} onRevoke={onRevoke} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function TokenRow({
  token,
  onRevoke,
}: {
  readonly token: AgentTokenInfo;
  readonly onRevoke: (tokenId: string) => Promise<void>;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const openConfirm = (): void => setConfirmOpen(true);
  const closeConfirm = (): void => {
    if (revoking) return;
    setConfirmOpen(false);
  };
  const handleRevoke = async (): Promise<void> => {
    setRevoking(true);
    try {
      await onRevoke(token.tokenId);
      setConfirmOpen(false);
    } finally {
      setRevoking(false);
    }
  };

  return (
    <tr>
      <td>{token.name}</td>
      <td>
        {token.scopes.map((s) => (
          <span key={s} className={styles['scopeBadge']}>
            {s}
          </span>
        ))}
      </td>
      <td>{formatDate(token.issuedAt)}</td>
      <td>{formatDate(token.expiresAt)}</td>
      <td>
        <span
          className={token.revoked ? styles['statusRevoked'] : styles['statusActive']}
        >
          {token.revoked ? 'Revoked' : 'Active'}
        </span>
      </td>
      <td>
        {!token.revoked ? (
          <>
            <Button
              size="sm"
              variant="destructive"
              onClick={openConfirm}
              aria-label={`Revoke ${token.name}`}
            >
              Revoke
            </Button>
            <Dialog
              open={confirmOpen}
              onClose={closeConfirm}
              title="Revoke token?"
              footer={
                <>
                  <Button variant="secondary" onClick={closeConfirm} disabled={revoking}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      void handleRevoke();
                    }}
                    disabled={revoking}
                  >
                    {revoking ? 'Revoking…' : 'Revoke token'}
                  </Button>
                </>
              }
            >
              <p>
                <strong>{token.name}</strong> will lose access immediately.
                Any agent using this token will start receiving 401s on the
                next call.
              </p>
              <p>
                This is permanent — issued tokens can't be un-revoked.
                Issue a new token if the agent should regain access.
              </p>
            </Dialog>
          </>
        ) : null}
      </td>
    </tr>
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

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

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

