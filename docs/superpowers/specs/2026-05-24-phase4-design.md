# Phase 4 Design: Full UX Redesign + Calendar, Contacts, Agent Dashboard

**Date:** 2026-05-24
**Status:** Approved
**Prereqs:** Phase 3 complete (v0.6.0 deployed)

## Overview

Phase 4 transforms Iarsma from a functional skeleton into a polished, responsive webmail with calendar, contacts, and an agent dashboard. Linear/Notion-inspired aesthetic — clean, minimal, keyboard-first on desktop, touch-optimized on mobile.

**Responsive targets:** Desktop browser, iPad, Android tablet, Android phone, iOS phone.

Fifteen work items ship across three release cuts:

| Cut | Version | Subsystems |
|-----|---------|-----------|
| 4a  | v0.7.0  | Design system + shell redesign (responsive sidebar, command palette, dark mode, component library, mail view polish) |
| 4b  | v0.8.0  | Calendar capabilities + CalendarView + event composer + ICS extraction |
| 4c  | v0.9.0  | Contacts capabilities + ContactsView + autocomplete + agent dashboard + provenance UI + log grouping |

---

## Responsive Strategy

**Breakpoints:**

| Name | Width | Layout |
|------|-------|--------|
| Mobile | < 640px | Single column, bottom nav, full-screen views |
| Tablet | 640px–1024px | Two columns (sidebar + content), collapsible sidebar |
| Desktop | > 1024px | Three columns (sidebar + list + detail), persistent sidebar |

**Principles:**
- Mobile-first CSS: base styles for mobile, `@media (min-width: ...)` for larger
- Touch targets: 44px minimum on mobile/tablet
- No hover-only interactions: everything reachable via tap
- Swipe: thread list swipe-left for archive/delete (mobile)
- Bottom nav on mobile replaces sidebar: Mail, Calendar, Contacts, More (→ Approvals, Activity, Settings)
- Viewport meta tag: `<meta name="viewport" content="width=device-width, initial-scale=1">`

---

## Cut 4a: Design System + Shell Redesign (v0.7.0)

### Item 1 — Design Tokens + Open Props

**Files:** `shell/src/styles/tokens.css`, `shell/src/styles/reset.css`, `shell/src/styles/global.css`

Install Open Props (`pnpm add open-props`). Define design tokens:

```css
:root {
  /* Surface hierarchy */
  --surface-1: var(--gray-0);      /* page background */
  --surface-2: var(--gray-1);      /* cards, sidebar */
  --surface-3: var(--gray-2);      /* elevated, hover */
  --text-1: var(--gray-9);         /* primary text */
  --text-2: var(--gray-6);         /* secondary text */
  --text-3: var(--gray-4);         /* muted text */

  /* Accent */
  --accent: var(--indigo-6);
  --accent-hover: var(--indigo-7);
  --destructive: var(--red-6);
  --success: var(--green-6);
  --warning: var(--yellow-5);

  /* Spacing (4px grid) */
  --space-xs: var(--size-1);       /* 4px */
  --space-sm: var(--size-2);       /* 8px */
  --space-md: var(--size-3);       /* 12px */
  --space-lg: var(--size-5);       /* 20px */
  --space-xl: var(--size-7);       /* 36px */

  /* Typography */
  --font-body: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'SF Mono', 'Fira Code', monospace;
  --text-sm: 0.8125rem;            /* 13px */
  --text-base: 0.875rem;           /* 14px */
  --text-lg: 1rem;                 /* 16px */
  --text-xl: 1.25rem;              /* 20px */

  /* Radius */
  --radius-sm: var(--radius-1);    /* 4px */
  --radius-md: var(--radius-2);    /* 6px */
  --radius-lg: var(--radius-3);    /* 8px */

  /* Transitions */
  --transition-fast: 150ms var(--ease-3);
  --transition-normal: 250ms var(--ease-3);
}

[data-theme="dark"] {
  --surface-1: var(--gray-9);
  --surface-2: var(--gray-8);
  --surface-3: var(--gray-7);
  --text-1: var(--gray-0);
  --text-2: var(--gray-3);
  --text-3: var(--gray-5);
}
```

### Item 2 — Component Library

**Files:** `shell/src/components/` — one file per component + CSS module

Reusable components used across all views:

- **Button**: `primary | secondary | ghost | destructive` variants. Sizes: `sm | md | lg`. 44px min-height on mobile.
- **Input**: text, search, email. Label + error message slots.
- **Select**: native select with styled wrapper.
- **Badge**: count (numeric), status (colored dot + label), scope (outlined).
- **Card**: elevated surface with optional header/footer slots.
- **Dialog**: modal overlay with focus trap, Escape to close. Full-screen on mobile.
- **Avatar**: initials-based with color hash. For contacts and agents.
- **Skeleton**: loading placeholder (pulsing gray blocks).
- **IconButton**: icon-only button with tooltip. For toolbar actions.
- **Tooltip**: positioned overlay on hover/focus.
- **EmptyState**: illustration + message + optional action button.

### Item 3 — Responsive Shell Layout

**Files:** `shell/src/App.tsx`, `shell/src/styles/layout.css`, `shell/src/components/sidebar.tsx`, `shell/src/components/bottom-nav.tsx`

**Desktop (>1024px):** Persistent sidebar (240px) + main content area. Sidebar contains: logo, nav items (Mail, Calendar, Contacts, Approvals, Activity, Settings), mailbox tree, user section at bottom with dark mode toggle.

**Tablet (640–1024px):** Collapsible sidebar (hamburger icon). When open, overlays as a drawer. Main content fills width.

**Mobile (<640px):** No sidebar. Bottom navigation bar with 5 icons: Mail, Calendar, Contacts, More (overflow menu → Approvals, Activity, Settings). Content is single-column, full-screen views with back-navigation.

**Navigation state:** `activeViewAtom` already exists. Add `sidebarOpenAtom` for tablet drawer state.

### Item 4 — Command Palette

**Files:** `shell/src/components/command-palette.tsx`, `shell/src/components/command-palette.css`

`Cmd+K` / `Ctrl+K` opens a centered modal search. Type to filter:
- Mailboxes: "inbox", "drafts", "sent"
- Actions: "compose", "settings", "sign out"
- Search threads: prefix with `>` to search thread content
- Future: contacts, calendar events

Arrow keys + Enter to select. Escape to close. Recent items shown when empty.

Hidden on mobile (not enough space for a palette UX). Mobile uses the nav + dedicated search screen.

### Item 5 — Dark Mode

**Files:** `shell/src/runtime/theme.ts`, updates to all CSS

`themeAtom` stores `'light' | 'dark' | 'system'`. Toggle in sidebar user section. `data-theme` attribute on `<html>`. System preference via `matchMedia('(prefers-color-scheme: dark)')`.

All components use CSS custom properties — the theme swap is zero-JS at render time.

### Item 6 — Mail View Polish

**Files:** Updates to `mailbox-list.tsx`, `thread-list.tsx`, `thread-view.tsx`, `compose-view.tsx` + new CSS modules

**Thread list redesign:**
- Compact rows: sender avatar (initials), bold subject, preview snippet (truncated), relative timestamp
- Unread: bold subject + accent dot
- Selected: subtle background highlight
- Mobile: full-width cards, swipe-left for quick actions
- Keyboard: j/k navigation with visible focus

**Thread view redesign:**
- Message cards with clear sender, timestamp, expand/collapse
- Inline image rendering
- Attachment chips (click to download)
- Reply bar sticky at bottom

**Compose redesign:**
- Full dialog with proper form layout
- Rich text toolbar (Squire) with formatting buttons
- Attachment chips with remove button
- Identity selector dropdown
- Mobile: full-screen compose

---

## Cut 4b: Calendar (v0.8.0)

### Item 7 — Calendar Read Capabilities

`calendar.list`, `event.list`, `event.get` — JMAP CalendarEvent (RFC 8984). Contract → jmap-client → invoker → hook. Same pipeline as mail capabilities.

### Item 8 — CalendarView

Month/week/day toggles. Event blocks colored by calendar. Keyboard: arrow keys navigate days, `t` jumps to today, `m/w/d` switches view.

**Responsive:**
- Desktop: full calendar grid with time slots
- Tablet: same grid, slightly denser
- Mobile: agenda view (vertical list of events) as default, with option to switch to month overview

### Item 9 — Calendar Write Capabilities + Event Composer

`event.create`, `event.update`, `event.cancel`, `event.rsvp` — each with dry-run. Event composer modal with title, time range picker, attendees, location, description, calendar selector.

### Item 10 — ICS Extraction

Parse `text/calendar` MIME parts in thread view. Show structured event card with date/time/location + Accept/Decline/Tentative buttons wired to `event.rsvp`.

---

## Cut 4c: Contacts + Agent UX (v0.9.0)

### Item 11 — Contact Capabilities

`contact.list`, `contact.get`, `contact.create`, `contact.update`, `contact.delete` — JMAP ContactCard (RFC 9553). Each write with dry-run.

### Item 12 — ContactsView

Searchable contact list + detail pane. Edit form for create/update. Avatar with initials.

**Responsive:**
- Desktop: two-column (list + detail)
- Mobile: list view → tap to detail (push navigation)

### Item 13 — Composer Recipient Autocomplete

As-you-type in To/Cc/Bcc fields. Sources: contacts + recent senders. Ranked by recency. Shows name + email + avatar. Keyboard: arrow keys + Enter to select.

### Item 14 — Agent Dashboard

Settings → Agents tab redesigned as a proper dashboard:
- Per-agent card: name, scopes as badges, recent activity sparkline, created date, kill switch toggle
- Aggregate stats at top: agent count, total actions today, denied actions
- Token issuance flow in a dialog instead of inline form

### Item 15 — Provenance UI + Action Log Grouping

- "Drafted by `<agent>`" badge in compose view when editing an agent-created draft
- Action log: group related agent actions (e.g., "Triaged 5 messages" expandable to individual entries)

---

## Definition of Done

The webmail looks and feels like a modern productivity app. It works well on a phone, an iPad, and a desktop. Calendar shows events, RSVP works from message view. Contacts autocomplete in compose. The agent dashboard shows who did what. Dark mode works everywhere.
