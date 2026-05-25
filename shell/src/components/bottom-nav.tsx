/**
 * BottomNav — mobile-only bottom navigation bar (Phase 4).
 *
 * Shows 5 items: Mail, Calendar, Contacts, Approvals (with badge),
 * and More (opens a sheet with Activity, Settings, Sign out).
 *
 * Only rendered/visible below 640px via CSS media query; the parent
 * conditionally renders it based on the `isMobile` breakpoint flag.
 */

import { useState } from 'react';
import type { ActiveView } from '../nav-state.js';
import styles from './bottom-nav.module.css';

// ── SVG icons (same family as sidebar) ──────────────────────────

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

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="19" r="1" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

// ── Types ────────────────────────────────────────────────────────

export type BottomNavProps = {
  readonly activeView: ActiveView;
  readonly onNavigate: (view: ActiveView) => void;
  readonly pendingApprovals?: number;
  readonly onSignOut: () => void;
};

// ── Component ───────────────────────────────────────────────────

export function BottomNav({
  activeView,
  onNavigate,
  pendingApprovals,
  onSignOut,
}: BottomNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);

  const primaryItems: readonly {
    view: ActiveView;
    label: string;
    icon: () => React.JSX.Element;
    badge?: number | undefined;
  }[] = [
    { view: 'mail', label: 'Mail', icon: MailIcon },
    { view: 'calendar', label: 'Calendar', icon: CalendarIcon },
    { view: 'contacts', label: 'Contacts', icon: ContactsIcon },
    {
      view: 'approvals',
      label: 'Approvals',
      icon: ApprovalsIcon,
      badge: pendingApprovals,
    },
  ];

  const isSecondaryActive = activeView === 'activity' || activeView === 'settings';

  return (
    <>
      {/* Sheet backdrop */}
      <div
        className={`${styles.sheetBackdrop} ${moreOpen ? styles.sheetBackdropVisible : ''}`}
        onClick={() => setMoreOpen(false)}
        aria-hidden="true"
      />

      {/* More sheet */}
      <div
        className={`${styles.moreSheet} ${moreOpen ? styles.moreSheetOpen : ''}`}
        role="menu"
        aria-label="More options"
        data-testid="more-sheet"
      >
        <button
          type="button"
          className={styles.sheetItem}
          role="menuitem"
          onClick={() => { onNavigate('activity'); setMoreOpen(false); }}
        >
          <span className={styles.navIcon}><ActivityIcon /></span>
          Activity
        </button>
        <button
          type="button"
          className={styles.sheetItem}
          role="menuitem"
          onClick={() => { onNavigate('settings'); setMoreOpen(false); }}
        >
          <span className={styles.navIcon}><SettingsIcon /></span>
          Settings
        </button>
        <button
          type="button"
          className={`${styles.sheetItem} ${styles.sheetItemDanger}`}
          role="menuitem"
          onClick={() => { onSignOut(); setMoreOpen(false); }}
        >
          <span className={styles.navIcon}><SignOutIcon /></span>
          Sign out
        </button>
      </div>

      {/* Bottom nav bar */}
      <nav className={styles.bottomNav} aria-label="Bottom navigation" data-testid="bottom-nav">
        {primaryItems.map(({ view, label, icon: Icon, badge }) => (
          <button
            key={view}
            type="button"
            className={`${styles.navButton} ${activeView === view ? styles.navButtonActive : ''}`}
            onClick={() => { onNavigate(view); setMoreOpen(false); }}
            aria-current={activeView === view ? 'page' : undefined}
            aria-label={badge !== undefined && badge > 0 ? `${label} (${badge} pending)` : label}
            data-testid={`bottom-nav-${view}`}
          >
            <span className={styles.navIcon}><Icon /></span>
            {label}
            {badge !== undefined && badge > 0 && (
              <span className={styles.badge}>{badge > 99 ? '99+' : badge}</span>
            )}
          </button>
        ))}
        <button
          type="button"
          className={`${styles.navButton} ${isSecondaryActive ? styles.navButtonActive : ''}`}
          onClick={() => setMoreOpen((o) => !o)}
          aria-label="More"
          aria-expanded={moreOpen}
          data-testid="bottom-nav-more"
        >
          <span className={styles.navIcon}><MoreIcon /></span>
          More
        </button>
      </nav>
    </>
  );
}
