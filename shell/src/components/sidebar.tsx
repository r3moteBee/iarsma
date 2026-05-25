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

import React from 'react';
import type { ActiveView } from '../nav-state.js';
import type { ThemePreference } from '../runtime/theme.js';
import styles from './sidebar.module.css';

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

function ActivityIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
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
};

// ── Nav item definitions ────────────────────────────────────────

type NavDef = {
  readonly view: ActiveView;
  readonly label: string;
  readonly icon: () => React.JSX.Element;
};

const NAV_ITEMS: readonly NavDef[] = [
  { view: 'mail', label: 'Mail', icon: MailIcon },
  { view: 'calendar', label: 'Calendar', icon: CalendarIcon },
  { view: 'contacts', label: 'Contacts', icon: ContactsIcon },
  { view: 'approvals', label: 'Approvals', icon: ApprovalsIcon },
  { view: 'activity', label: 'Activity', icon: ActivityIcon },
  { view: 'settings', label: 'Settings', icon: SettingsIcon },
];

// ── Mailbox tree helpers ────────────────────────────────────────

type MailboxNode = MailboxEntry & { readonly children: readonly MailboxNode[] };

function buildMailboxTree(mailboxes: readonly MailboxEntry[]): readonly MailboxNode[] {
  const childMap = new Map<string | null, MailboxEntry[]>();
  for (const mb of mailboxes) {
    const parentKey = mb.parentId ?? null;
    const existing = childMap.get(parentKey);
    if (existing !== undefined) {
      existing.push(mb);
    } else {
      childMap.set(parentKey, [mb]);
    }
  }

  function buildChildren(parentId: string | null): readonly MailboxNode[] {
    const children = childMap.get(parentId) ?? [];
    return children.map((mb) => ({
      ...mb,
      children: buildChildren(mb.id),
    }));
  }

  return buildChildren(null);
}

function MailboxTreeItem({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  readonly node: MailboxNode;
  readonly depth: number;
  readonly selectedId?: string | undefined;
  readonly onSelect?: ((id: string) => void) | undefined;
}) {
  const isSelected = selectedId === node.id;
  return (
    <>
      <button
        type="button"
        className={`${styles.mailboxItem} ${isSelected ? styles.mailboxItemSelected : ''}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => onSelect?.(node.id)}
        aria-current={isSelected ? 'true' : undefined}
      >
        <span className={styles.mailboxName}>{node.name}</span>
        {node.unreadCount > 0 && (
          <span className={styles.mailboxUnread}>{node.unreadCount}</span>
        )}
      </button>
      {node.children.map((child) => (
        <MailboxTreeItem
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

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
}: SidebarProps) {
  const tree = mailboxes !== undefined ? buildMailboxTree(mailboxes) : [];

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
          {NAV_ITEMS.map(({ view, label, icon: Icon }) => (
            <React.Fragment key={view}>
              <button
                type="button"
                className={`${styles.navItem} ${activeView === view ? styles.navItemActive : ''}`}
                onClick={() => handleNavClick(view)}
                aria-current={activeView === view ? 'page' : undefined}
                data-testid={`nav-${view}`}
              >
                <span className={styles.navIcon}><Icon /></span>
                {label}
              </button>
              {view === 'mail' && activeView === 'mail' && tree.length > 0 && (
                <div className={styles.mailboxInline}>
                  {tree.map((node) => (
                    <MailboxTreeItem
                      key={node.id}
                      node={node}
                      depth={1}
                      selectedId={selectedMailboxId}
                      onSelect={(id) => { onMailboxSelect?.(id); onClose?.(); }}
                    />
                  ))}
                </div>
              )}
            </React.Fragment>
          ))}
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
          </div>
        </div>
      </aside>
    </>
  );
}
