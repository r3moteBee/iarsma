/**
 * AgentSettingsView — token management UI for agent credentials.
 *
 * Two sections:
 *   1. Issue New Token form (name, scopes, lifetime, submit).
 *   2. Active Tokens table (name, scopes, issued, expires, status, action).
 *
 * The view is purely presentational — all side-effect work (network calls
 * to issue / revoke tokens) is delegated to callback props.
 */

import { useState } from 'react';
import type { AgentTokenInfo, IssuedToken } from '../runtime/agent-token-issuer.js';

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
};

// ── Component ──────────────────────────────────────────────────────

export function AgentSettingsView({
  tokens,
  onIssue,
  onRevoke,
  isLoading,
}: AgentSettingsViewProps) {
  return (
    <section aria-labelledby="agent-settings-heading" style={{ maxWidth: '56em' }}>
      <h2 id="agent-settings-heading">Agent Settings</h2>
      {isLoading === true ? <p>Loading tokens...</p> : null}
      <IssueTokenForm onIssue={onIssue} />
      <TokenTable tokens={tokens} onRevoke={onRevoke} />
    </section>
  );
}

// ── Issue Token Form ───────────────────────────────────────────────

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
      if (next.has(scope)) {
        next.delete(scope);
      } else {
        next.add(scope);
      }
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
      // Reset form
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
      // Fallback: select the text for manual copy
    }
  };

  return (
    <section aria-labelledby="issue-token-heading" style={{ marginBottom: '2em' }}>
      <h3 id="issue-token-heading">Issue New Token</h3>

      {issuedSecret !== null ? (
        <div
          role="alert"
          style={{
            padding: '1em',
            border: '2px solid var(--warning)',
            borderRadius: 4,
            background: 'color-mix(in srgb, var(--warning) 15%, transparent)',
            marginBottom: '1em',
          }}
        >
          <p>
            <strong>Client Secret:</strong>{' '}
            <code style={{ wordBreak: 'break-all' }}>{issuedSecret.clientSecret}</code>
          </p>
          <button type="button" onClick={handleCopy} aria-label="Copy secret">
            {copyFeedback ? 'Copied!' : 'Copy'}
          </button>
          <p style={{ color: 'var(--warning)', marginTop: '0.5em', fontSize: '0.9em' }}>
            This secret won't be shown again. Store it securely now.
          </p>
          <button
            type="button"
            onClick={() => setIssuedSecret(null)}
            style={{ marginTop: '0.5em' }}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '0.75em' }}>
          <label htmlFor="agent-name-input">Agent name</label>
          <br />
          <input
            id="agent-name-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={{
              padding: '0.3em 0.5em',
              font: 'inherit',
              border: '1px solid var(--surface-3)',
              borderRadius: 4,
              width: '20em',
              color: 'var(--text-1)',
              background: 'var(--surface-2)',
            }}
          />
        </div>

        <fieldset
          style={{
            border: '1px solid var(--surface-3)',
            borderRadius: 4,
            padding: '0.5em 0.75em',
            marginBottom: '0.75em',
          }}
        >
          <legend>Scopes</legend>
          {ALL_SCOPES.map((scope) => (
            <label
              key={scope}
              style={{ display: 'inline-block', marginRight: '1em', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={selectedScopes.has(scope)}
                onChange={() => toggleScope(scope)}
                style={{ marginRight: '0.3em' }}
              />
              {scope}
            </label>
          ))}
        </fieldset>

        <div style={{ marginBottom: '0.75em' }}>
          <label htmlFor="lifetime-select">Lifetime</label>
          <br />
          <select
            id="lifetime-select"
            value={lifetimeSec}
            onChange={(e) => setLifetimeSec(Number(e.target.value))}
            style={{
              padding: '0.3em 0.5em',
              font: 'inherit',
              border: '1px solid var(--surface-3)',
              borderRadius: 4,
              color: 'var(--text-1)',
              background: 'var(--surface-2)',
            }}
          >
            {LIFETIME_OPTIONS.map((opt) => (
              <option key={opt.seconds} value={opt.seconds}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" disabled={!canSubmit}>
          {isSubmitting ? 'Issuing...' : 'Issue Token'}
        </button>
      </form>
    </section>
  );
}

// ── Token Table ────────────────────────────────────────────────────

function TokenTable({
  tokens,
  onRevoke,
}: {
  readonly tokens: readonly AgentTokenInfo[];
  readonly onRevoke: (tokenId: string) => Promise<void>;
}) {
  return (
    <section aria-labelledby="active-tokens-heading">
      <h3 id="active-tokens-heading">Active Tokens</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th scope="col" style={thStyle}>Name</th>
            <th scope="col" style={thStyle}>Scopes</th>
            <th scope="col" style={thStyle}>Issued</th>
            <th scope="col" style={thStyle}>Expires</th>
            <th scope="col" style={thStyle}>Status</th>
            <th scope="col" style={thStyle}>Action</th>
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

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.4em 0.6em',
  borderBottom: '2px solid var(--surface-3)',
};

const tdStyle: React.CSSProperties = {
  padding: '0.4em 0.6em',
  borderBottom: '1px solid var(--surface-3)',
};

const badgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '0.1em 0.4em',
  margin: '0.1em 0.2em',
  borderRadius: 3,
  fontSize: '0.85em',
  background: 'var(--surface-3)',
  color: 'var(--text-1)',
};

function TokenRow({
  token,
  onRevoke,
}: {
  readonly token: AgentTokenInfo;
  readonly onRevoke: (tokenId: string) => Promise<void>;
}) {
  const [revoking, setRevoking] = useState(false);

  const handleRevoke = async () => {
    setRevoking(true);
    try {
      await onRevoke(token.tokenId);
    } finally {
      setRevoking(false);
    }
  };

  return (
    <tr>
      <td style={tdStyle}>{token.name}</td>
      <td style={tdStyle}>
        {token.scopes.map((s) => (
          <span key={s} style={badgeStyle}>
            {s}
          </span>
        ))}
      </td>
      <td style={tdStyle}>{formatDate(token.issuedAt)}</td>
      <td style={tdStyle}>{formatDate(token.expiresAt)}</td>
      <td style={tdStyle}>
        {token.revoked ? (
          <span style={{ color: 'var(--destructive)', fontWeight: 600 }}>Revoked</span>
        ) : (
          <span style={{ color: 'var(--success)', fontWeight: 600 }}>Active</span>
        )}
      </td>
      <td style={tdStyle}>
        {!token.revoked ? (
          <button type="button" onClick={handleRevoke} disabled={revoking}>
            {revoking ? 'Revoking...' : 'Revoke'}
          </button>
        ) : null}
      </td>
    </tr>
  );
}

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
