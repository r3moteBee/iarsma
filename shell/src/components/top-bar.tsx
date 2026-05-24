/**
 * TopBar — horizontal bar at the top of the main content area
 * (Phase 4 responsive shell).
 *
 * Tablet: shows hamburger icon to toggle sidebar drawer.
 * Mobile: shows back arrow on detail views, centered title.
 * Desktop: not rendered (sidebar handles nav).
 */

import type React from 'react';
import styles from './top-bar.module.css';

// ── SVG icons ───────────────────────────────────────────────────

function HamburgerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function BackArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

// ── Types ────────────────────────────────────────────────────────

export type TopBarProps = {
  readonly title?: string;
  readonly onMenuToggle?: () => void;
  readonly showBackButton?: boolean;
  readonly onBack?: () => void;
  readonly actions?: React.ReactNode;
};

// ── Component ───────────────────────────────────────────────────

export function TopBar({
  title,
  onMenuToggle,
  showBackButton,
  onBack,
  actions,
}: TopBarProps) {
  return (
    <header className={styles.topBar} data-testid="top-bar">
      {/* Left: hamburger (tablet) or back arrow (mobile detail) */}
      {showBackButton === true && onBack !== undefined ? (
        <button
          type="button"
          className={styles.menuButton}
          onClick={onBack}
          aria-label="Go back"
          data-testid="top-bar-back"
        >
          <BackArrowIcon />
        </button>
      ) : onMenuToggle !== undefined ? (
        <button
          type="button"
          className={styles.menuButton}
          onClick={onMenuToggle}
          aria-label="Toggle menu"
          data-testid="top-bar-menu"
        >
          <HamburgerIcon />
        </button>
      ) : null}

      {/* Center: title */}
      {title !== undefined && (
        <span className={styles.title} data-testid="top-bar-title">
          {title}
        </span>
      )}

      {/* Right: action buttons */}
      {actions !== undefined && (
        <div className={styles.actions}>
          {actions}
        </div>
      )}
    </header>
  );
}
