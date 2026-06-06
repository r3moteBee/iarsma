/**
 * Sidebar — primary navigation rail for desktop and tablet layouts
 * (Phase 4 responsive shell).
 *
 * Desktop (>=1024px): always-visible 240px fixed sidebar.
 * Tablet (640-1023px): slide-over drawer triggered by hamburger.
 * Mobile (<640px): not rendered — BottomNav handles navigation.
 *
 * The sidebar owns: logo, compose button, view navigation, mailbox
 * tree (mail view only), user info, sign-out, and theme toggle.
 */

import React, { useEffect, useState } from 'react';
import type { ActiveView } from '../nav-state.js';
import type { ThemePreference } from '../runtime/theme.js';
import { AccentPicker } from './accent-picker.js';
import { DensitySelector } from './density-selector.js';
import { MailboxTreeView } from './mailbox-tree-view.js';
import styles from './sidebar.module.css';

const MAIL_SECTION_KEY = 'iarsma-mail-section-collapsed';

function loadMailSectionCollapsed(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(MAIL_SECTION_KEY) === '1';
  } catch {
    return false;
  }
}

function saveMailSectionCollapsed(value: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(MAIL_SECTION_KEY, value ? '1' : '0');
  } catch {
    // Quota / private mode — non-fatal.
  }
}

// ── SVG icon paths ──────────────────────────────────────────────

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 7l-10 7L2 7" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function ContactsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

function ApprovalsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </svg>
  );
}

function FilesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function ActivityIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function OutboxIcon() {
  // Paper-plane glyph — distinct from the static Mail/envelope icon so
  // "mail waiting to leave" reads at a glance.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2L11 13" />
      <path d="M22 2L15 22 11 13 2 9 22 2z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function ComposeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

// ── Types ────────────────────────────────────────────────────────

export type MailboxEntry = {
  readonly id: string;
  readonly name: string;
  readonly role?: string;
  readonly unreadCount: number;
  readonly parentId?: string | null;
};

export type SidebarProps = {
  readonly activeView: ActiveView;
  readonly onNavigate: (view: ActiveView) => void;
  readonly mailboxes?: readonly MailboxEntry[];
  readonly onMailboxSelect?: (id: string) => void;
  readonly selectedMailboxId?: string;
  readonly onCompose: () => void;
  readonly userName?: string | undefined;
  readonly onSignOut: () => void;
  readonly theme: ThemePreference;
  readonly onThemeChange: (theme: ThemePreference) => void;
  readonly isOpen?: boolean;
  readonly onClose?: () => void;
  /** Number of pending sends in the SendBuffer (PR 27). The Outbox
   *  nav item hides when 0 and shows with a count badge when > 0 —
   *  Outlook semantics: the folder appears only when relevant. */
  readonly outboxCount?: number;
  /** Unread Inbox count for the Mail nav badge (Phase 3 #9). Shows
   *  next to "Mail" when > 0; lifted out of the per-folder tree so
   *  the user sees new mail without expanding the section. */
  readonly inboxUnreadCount?: number;
};

// ── Nav item definitions ────────────────────────────────────────

type NavDef = {
  readonly view: ActiveView;
  readonly label: string;
  readonly icon: () => React.JSX.Element;
};

const NAV_ITEMS: readonly NavDef[] = [
  { view: 'mail', label: 'Mail', icon: MailIcon },
  { view: 'outbox', label: 'Outbox', icon: OutboxIcon },
  { view: 'calendar', label: 'Calendar', icon: CalendarIcon },
  { view: 'contacts', label: 'Contacts', icon: ContactsIcon },
  { view: 'files', label: 'Files', icon: FilesIcon },
  { view: 'approvals', label: 'Approvals', icon: ApprovalsIcon },
  { view: 'activity', label: 'Activity', icon: ActivityIcon },
  { view: 'settings', label: 'Settings', icon: SettingsIcon },
];

// ── Component ───────────────────────────────────────────────────

export function Sidebar({
  activeView,
  onNavigate,
  mailboxes,
  onMailboxSelect,
  selectedMailboxId,
  onCompose,
  userName,
  onSignOut,
  theme,
  onThemeChange,
  isOpen,
  onClose,
  outboxCount,
  inboxUnreadCount,
}: SidebarProps) {
  const hasMailboxes = mailboxes !== undefined && mailboxes.length > 0;

  // Section-level collapse: the user can hide the whole folder list to
  // reclaim sidebar space. Per-parent collapse lives inside MailboxTreeView.
  const [mailSectionCollapsed, setMailSectionCollapsed] = useState<boolean>(
    () => loadMailSectionCollapsed(),
  );
  useEffect(() => {
    saveMailSectionCollapsed(mailSectionCollapsed);
  }, [mailSectionCollapsed]);

  const handleNavClick = (view: ActiveView) => {
    onNavigate(view);
    onClose?.();
  };

  const cycleTheme = (next: ThemePreference) => {
    onThemeChange(next);
  };

  return (
    <>
      {/* Backdrop for tablet drawer */}
      <div
        className={`${styles.backdrop} ${isOpen === true ? styles.backdropVisible : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className={`${styles.sidebar} ${isOpen === true ? styles.sidebarOpen : ''}`}
        aria-label="Main navigation"
        data-testid="sidebar"
      >
        {/* Header: logo + compose */}
        <div className={styles.header}>
          <span className={styles.logo}>Iarsma <span className={styles.version}>{__APP_VERSION__}</span></span>
          <button
            type="button"
            className={styles.composeButton}
            onClick={() => { onCompose(); onClose?.(); }}
            aria-label="Compose new message"
          >
            <span className={styles.navIcon}><ComposeIcon /></span>
            Compose
          </button>
        </div>

        {/* Navigation items with mailboxes nested under Mail */}
        <nav className={styles.nav} aria-label="Views">
          {NAV_ITEMS.map(({ view, label, icon: Icon }) => {
            // PR 27 — Outbox nav row only renders when there's at
            // least one pending send. Active view stays selectable
            // even when the badge drops to 0 mid-navigation; once
            // the user navigates away it disappears.
            if (
              view === 'outbox' &&
              (outboxCount === undefined || outboxCount === 0) &&
              activeView !== 'outbox'
            ) {
              return null;
            }
            // Per-row badge: Outbox shows pending sends; Mail shows
            // Inbox unread. Other rows currently have no badge.
            const badgeValue: number | undefined =
              view === 'outbox' && (outboxCount ?? 0) > 0
                ? outboxCount
                : view === 'mail' && (inboxUnreadCount ?? 0) > 0
                  ? inboxUnreadCount
                  : undefined;
            const ariaSuffix =
              view === 'outbox' && badgeValue !== undefined
                ? `(${badgeValue} pending)`
                : view === 'mail' && badgeValue !== undefined
                  ? `(${badgeValue} unread)`
                  : undefined;
            const navButton = (
              <button
                type="button"
                className={`${styles.navItem} ${activeView === view ? styles.navItemActive : ''}`}
                onClick={() => handleNavClick(view)}
                aria-current={activeView === view ? 'page' : undefined}
                data-testid={`nav-${view}`}
                aria-label={
                  ariaSuffix !== undefined ? `${label} ${ariaSuffix}` : undefined
                }
              >
                <span className={styles.navIcon}><Icon /></span>
                {label}
                {badgeValue !== undefined ? (
                  <span className={styles.outboxBadge} aria-hidden="true">
                    {badgeValue}
                  </span>
                ) : null}
              </button>
            );
            // Mail gets a paired section-collapse caret when mailboxes
            // are loaded — independent button, real aria-expanded, real
            // aria-label, persisted state.
            if (view === 'mail' && hasMailboxes) {
              return (
                <React.Fragment key={view}>
                  <div className={styles.mailNavRow}>
                    {navButton}
                    <button
                      type="button"
                      className={styles.mailSectionToggle}
                      aria-expanded={!mailSectionCollapsed}
                      aria-controls="sidebar-mailbox-tree"
                      aria-label={mailSectionCollapsed ? 'Show mailbox folders' : 'Hide mailbox folders'}
                      onClick={() => setMailSectionCollapsed((c) => !c)}
                      data-testid="nav-mail-toggle"
                    >
                      {mailSectionCollapsed ? '▸' : '▾'}
                    </button>
                  </div>
                  {activeView === 'mail' && !mailSectionCollapsed && mailboxes !== undefined ? (
                    <div className={styles.mailboxInline} id="sidebar-mailbox-tree">
                      <MailboxTreeView
                        mailboxes={mailboxes}
                        {...(selectedMailboxId !== undefined ? { selectedId: selectedMailboxId } : {})}
                        onSelect={(id) => { onMailboxSelect?.(id); onClose?.(); }}
                      />
                    </div>
                  ) : null}
                </React.Fragment>
              );
            }
            return <React.Fragment key={view}>{navButton}</React.Fragment>;
          })}
        </nav>

        {/* Footer: user info + theme */}
        <div style={{ flex: '1 1 auto' }} />
        <div className={styles.footer}>
          <div className={styles.userRow}>
            {userName !== undefined && (
              <span className={styles.userName} title={userName}>{userName}</span>
            )}
            <button
              type="button"
              className={styles.signOutButton}
              onClick={() => { onSignOut(); onClose?.(); }}
            >
              Sign out
            </button>
          </div>
          <div className={styles.appearance} role="group" aria-label="Appearance">
            <div className={styles.themeRow} role="radiogroup" aria-label="Theme preference">
              <button
                type="button"
                className={`${styles.themeButton} ${theme === 'light' ? styles.themeButtonActive : ''}`}
                onClick={() => cycleTheme('light')}
                aria-label="Light theme"
                aria-checked={theme === 'light'}
                role="radio"
              >
                <SunIcon />
              </button>
              <button
                type="button"
                className={`${styles.themeButton} ${theme === 'dark' ? styles.themeButtonActive : ''}`}
                onClick={() => cycleTheme('dark')}
                aria-label="Dark theme"
                aria-checked={theme === 'dark'}
                role="radio"
              >
                <MoonIcon />
              </button>
              <button
                type="button"
                className={`${styles.themeButton} ${theme === 'system' ? styles.themeButtonActive : ''}`}
                onClick={() => cycleTheme('system')}
                aria-label="System theme"
                aria-checked={theme === 'system'}
                role="radio"
              >
                <MonitorIcon />
              </button>
              <AccentPicker />
            </div>
            <DensitySelector />
          </div>
        </div>
      </aside>
    </>
  );
}
