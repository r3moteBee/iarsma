# Iarsma — UI/UX Design Analysis & Implementation Spec

> **Purpose.** A structured design review of the Iarsma webmail shell (`shell/src`) with
> concrete, implementable recommendations. Written to be handed to Claude Code as a work
> spec — exact token/component changes where precision matters, directional guidance for
> layout and UX where judgment matters.
>
> **Audience.** Claude Code (implementer) + Brent (reviewer).
>
> **Scope.** The React shell UI only. No backend, WASM-component, MCP, or auth-flow logic
> is in scope. Nothing here requires touching `components/`, `mcp-server/`, `wasm-bindings/`,
> or the Rust crates.
>
> **Companion file.** `mockups/iarsma-redesign.html` — an interactive reference mockup of
> the redesigned Inbox, Reading pane, and Compose modal, with working **Density selector**
> and **Accent picker**. Open it to see the target; it is built on the project's real tokens.

---

## 0. How to use this document

Each recommendation is tagged:

- **[EXACT]** — apply as written (token values, component swaps, specific props).
- **[DIRECTION]** — intent + constraints; choose the specific implementation.
- **♿ a11y** — accessibility note folded into the relevant recommendation.

Recommendations carry a priority: **P0** (broken / blocks daily use), **P1** (significant
clarity/consistency win), **P2** (polish). A consolidated roadmap is in §11.

Citations use `path:line` against the current `main` (`9fab317`). Line numbers are
approximate anchors, not contracts.

---

## 1. Executive summary

Iarsma already has the bones of a good design system: a token file (`styles/tokens.css`),
a component library with sensible variants (`Button`, `Input`, `Dialog`, `EmptyState`,
`Skeleton`, `Avatar`, `Card`, `Badge`), a responsive shell (`Sidebar` / `TopBar` /
`BottomNav`), strong ARIA/keyboard patterns, and dark mode. The newer feature views
(Calendar, Contacts, Files, Settings) consume these primitives cleanly.

**The central problem: the screens users live in — Inbox (ThreadList), Reading (ThreadView),
and Compose — do not use the design system.** They are built from raw native
`<button>`/`<input>` elements and hundreds of inline `style={{…}}` objects with hardcoded
values. The result is that the *heart* of the product is its *least* polished, least
consistent surface. This is the single highest-leverage thing to fix, and it is mostly
mechanical.

Five themes run through everything below:

1. **Adopt the system you already built.** Replace inline-styled native elements in the mail
   views with `Button`, `Input`, `EmptyState`, `Skeleton`, `Card`, and CSS Modules. (§4)
2. **Make accent + density first-class, user-controllable tokens.** Orange should be applied
   deliberately and attractively, and the user should be able to change it; spacing should
   respond to a Dense / Normal / Spacious selector. (§5)
3. **Fix the concrete defects.** Overlapping rows in the message list, panes with no visual
   separation, and missing CRUD affordances are real bugs, not taste. (§6, §7)
4. **Add the missing UI furniture.** A list toolbar, per-row actions, multi-select, unread
   indicators, "load more", and a back affordance on mobile. One built-but-unmounted
   component (`CommandPalette`) is sitting unused. (§7, §10)
5. **Commit to a future-forward, dependency-light CSS strategy** (CSS custom properties,
   `color-mix()`, container queries, `:has()`, `@layer`) rather than retrofitting Tailwind +
   shadcn/ui. This revises an early assumption in the brief — see §3.1. (§3, §5)

---

## 2. What's already good (keep / extend, don't replace)

So the redesign builds on strengths rather than churning them:

- **Token file** (`styles/tokens.css`): surface/text hierarchy, spacing on a 4px grid, a
  type scale, radii, shadows, transitions, and a clean dark-mode override. This is the right
  foundation — §5 extends it, it does not replace it.
- **`Button`** (`components/button.module.css`): `primary | secondary | ghost | destructive`
  × `sm | md | lg`, with a `@media (pointer: coarse)` 44px-min touch target. Genuinely good.
  It is simply not used in the mail views.
- **`Input`** (`components/input.module.css`): label, focus ring on `--accent`,
  `aria-invalid` → destructive border. Also unused in Compose/Search.
- **`EmptyState`, `Skeleton`, `Avatar`, `Card`, `Dialog`, `Badge`** — all present, all
  reasonable, mostly unused outside the newer views.
- **Accessibility patterns**: ARIA listbox in ThreadList, ARIA tree in `mailbox-list.tsx`,
  roving tabindex, focus management in Compose, visually-hidden read-state text, keyboard
  shortcuts (`j/k`, `n/p`, `c`, `/`, `?`, `e`, `r/R`). The bones of WCAG 2.1 AA (a Phase-1
  constraint in the brief) are here. §-by-§ a11y notes protect and extend this.
- **Responsive shell**: fixed sidebar (desktop) → drawer (tablet) → bottom nav (mobile) is
  the right model.
- **Squire** rich-text editor is the right composer engine (per brief); the issue is the
  chrome around it, not the engine.

---

## 3. Design principles for the redesign

Derived from the project brief, translated into UI rules:

- **Agents are first-class participants, rendered inline — not a robot icon.** The brief is
  explicit: agent activity belongs *in* the inbox and thread timeline, Compose has an
  "Agent Assist" surface, and the action log is inbox-adjacent. The visual system needs a
  consistent, calm way to show "an agent did / proposes this" (see §8.6). Design for it now
  even where the data isn't wired yet — leave the slot.
- **Propose → preview → approve → commit is a UI primitive.** Confirmation dialogs (human)
  and approval cards (agent) are the *same* pattern. They should share one visual treatment
  (a "preview card") rather than the current divergent ad-hoc modals. (§8.6, §8.7)
- **Clarity over density by default, but let the user choose.** The current UI is dense
  (14px base, ~12px secondary). Ship a density control (§5.3); make **Normal** the default,
  not today's Dense.
- **Accessibility is folded into every change, not a separate pass.** WCAG 2.1 AA: contrast,
  focus-visible, target size, semantic structure, motion-reduction.

### 3.1 Styling-strategy decision (resolves a brief/implementation conflict)

The brief and `index.css` both reference an intended migration to **Tailwind + shadcn/ui**.
The codebase instead evolved a **CSS-Modules + Open Props + custom-property tokens** approach
— and that approach is working well in the newer views.

**Recommendation [DIRECTION]: do not adopt Tailwind + shadcn/ui. Double down on the
CSS-native approach.** Rationale, aligned with the stated "future-forward, no deprecated
dependency anchors" preference:

- CSS custom properties + `color-mix()` + container queries + `:has()` + `@layer` now cover
  essentially everything Tailwind/shadcn were brought in to provide, with **zero runtime
  dependencies** and no build-time class-scanning step to age out.
- shadcn/ui couples you to Radix + a Tailwind config + a class-variance pattern — exactly the
  kind of dependency anchor to avoid for a project meant to endure (the name *means* "durable
  artifact").
- The component library you already have is the shadcn equivalent, minus the dependencies.

**Action:** update `index.css`'s comment ("full design system lands when shadcn/ui + Tailwind
go in") and the brief's Shell styling line to reflect the CSS-native direction, so the next
contributor (human or agent) doesn't "helpfully" install Tailwind.

---

## 4. The design-system adoption gap (P0 — highest leverage)

### 4.1 The split, by file

| View | Uses `components/*` + CSS Modules? | Status |
|---|---|---|
| `views/files-view.tsx` | ✅ `Button, Dialog, EmptyState, Skeleton` + `files-view.module.css` | Good — use as the reference pattern |
| `views/contacts-view.tsx` | ✅ `Avatar, Button, Dialog, Input` + `contacts-view.module.css` | Good |
| `views/calendar-view.tsx` | ✅ `Button, Dialog` + `calendar-view.module.css` | Good |
| `views/files-settings-panel.tsx` | ✅ `Button, Input` (some inline) | Mostly good |
| **`views/thread-list.tsx`** | ❌ all inline styles, native elements | **P0 — rebuild on the system** |
| **`views/thread-view.tsx`** | ❌ all inline styles, native `<button>` | **P0** |
| **`views/compose-view.tsx`** | ❌ all inline styles, native `<input>/<button>/<select>` | **P0** |
| `views/activity-view.tsx` | ❌ inline styles, module-level style objects | P1 |
| `views/approvals-view.tsx` | ❌ inline styles, native buttons | P1 |
| `App.tsx` (search bar, ~line 540) | ❌ inline-styled `<input>` + native buttons | P1 |

### 4.2 What to do [EXACT]

For every native element in the P0/P1 views:

- `<button …>` → `<Button variant="…" size="…">`. Map by role:
  - Send, primary CTAs → `variant="primary"`
  - Reply / Reply all / Forward / Cancel → `variant="secondary"`
  - Delete / Discard → `variant="destructive"`
  - Icon-only toolbar actions, "Show", "Clear" → `variant="ghost"`
- `<input type="text|search">` → `<Input>` (it already carries label, focus ring,
  `aria-invalid`). The Compose `fieldStyle`/`errorStyle` objects
  (`compose-view.tsx:~470`) become Input props.
- `<p>Loading…</p>` / `<p>Select a thread…</p>` → `<EmptyState title description>` for empty
  states; `<Skeleton>` for loading; keep `role="alert"` text for errors but style it with a
  shared `.errorBanner` module class (see §8.8).
- Inline `style={{…}}` → a co-located `*.module.css`, one per view, mirroring the
  `contacts-view.module.css` structure. Replace hardcoded values with tokens:
  - `borderRadius: 4` → `var(--radius-sm)`; `8` → `var(--radius-md)`
  - `'0.5em' / '0.75em' / '1em'` paddings → `var(--space-sm | -md | -lg)`
  - `'1px solid var(--surface-3)'` → keep, but centralize as `--border` (see §5.1)
  - the stray fallback `var(--accent, #3b82f6)` in `layout.module.css:~95` (blue!) →
    `var(--accent)` with no blue fallback. This is the only place a non-brand blue leaks in.

**Net effect:** the mail views inherit hover/active/focus/disabled states, dark-mode, density,
and accent theming "for free," and stop drifting from the rest of the app.

♿ **a11y:** native `<button>`s currently rely on default UA focus rings; `Button` ships a
`:focus-visible` ring on `--accent` with `outline-offset`. Swapping in `Button` *improves*
keyboard visibility uniformly. Keep every existing `aria-label` when swapping.

---

## 5. Token & theming architecture (accent picker + density selector)

This section is the foundation for two requested features: **user-changeable accent colors**
and a **Dense / Normal / Spacious** density selector. Both are pure token work — no component
needs to know they exist.

### 5.1 Refactor tokens to be derivable [EXACT]

In `styles/tokens.css`, restructure the accent + border + spacing tokens so everything
downstream derives from a small set of roots:

```css
:root {
  /* ── Accent: ONE source of truth, everything else derived ── */
  --accent-h: 18;            /* hue  — orange */
  --accent-s: 100%;          /* sat  */
  --accent-l: 60%;           /* light*/
  --accent: hsl(var(--accent-h) var(--accent-s) var(--accent-l));      /* ≈ #ff6b35 */
  --accent-hover: hsl(var(--accent-h) var(--accent-s) calc(var(--accent-l) - 8%));
  --accent-active: hsl(var(--accent-h) var(--accent-s) calc(var(--accent-l) - 14%));
  --accent-subtle: color-mix(in srgb, var(--accent) 12%, transparent);
  --accent-on:  #ffffff;     /* text/icon color on top of --accent */

  /* ── Borders: name the concept, stop hardcoding surface-3 as a border ── */
  --border:        var(--surface-3);
  --border-strong: color-mix(in srgb, var(--surface-3) 60%, var(--text-3));

  /* ── Spacing: a density multiplier feeds the 4px grid ── */
  --density: 1;                                  /* set by the density selector */
  --space-xs: calc(4px  * var(--density));
  --space-sm: calc(8px  * var(--density));
  --space-md: calc(16px * var(--density));
  --space-lg: calc(24px * var(--density));
  --space-xl: calc(32px * var(--density));

  /* row heights also scale with density (see §6.1) */
  --row-mail: calc(64px * var(--density));
}
```

> **Why HSL-derived accent, not the current flat `--accent-hover: #ff9d23`:** today's hover
> color (`tokens.css:19`) is both *lighter* and *hue-shifted toward yellow* than the base —
> so hovering an orange button makes it look like a different, washed-out color. Deriving
> hover/active by lowering *lightness* on a fixed hue keeps the brand coherent and is what
> makes orange feel intentional rather than accidental (§9). `color-mix()` is already used in
> the codebase (`activity-view.tsx`, `files-view.tsx`), so it's a safe primitive here.

### 5.2 Accent picker [EXACT data] [DIRECTION ui]

**Placement:** put the picker in the **sidebar footer**, directly under the account name as a
small "Appearance" cluster *next to the existing light/dark toggle* (`sidebar.tsx:~300`) — so
theme + accent live together where the user already looks — and mirror the same control in
**Settings → Appearance** for discoverability. Selecting a swatch writes
`--accent-h/s/l` onto `document.documentElement` and persists to the existing prefs store
(the same IndexedDB-backed mechanism `themePreferenceAtom` uses).

Curated set (orange is the default and first):

| Name | `--accent-h` | `--accent-s` | `--accent-l` | ≈ hex |
|---|---|---|---|---|
| **Ember** (default) | 18 | 100% | 60% | #ff6b35 |
| Amber | 38 | 95% | 55% | #f5a623 |
| Sky | 205 | 90% | 52% | #1f9bf0 |
| Violet | 265 | 75% | 62% | #9b6bff |
| Teal | 175 | 65% | 42% | #25a896 |
| Rose | 345 | 80% | 60% | #f2587f |

- Persist as `{ accentH, accentS, accentL }`; apply on boot before first paint (set on
  `<html>` in the same place `data-theme` is resolved) to avoid a flash.
- ♿ **a11y:** each swatch is a `role="radio"` in a `role="radiogroup"` (mirror the existing
  theme toggle in `sidebar.tsx:~300`), labelled by name, not color alone. Because text on
  accent uses `--accent-on: #fff`, verify each swatch meets ≥4.5:1 for body / ≥3:1 for large
  text; the six above are pre-checked at `--accent-l ≤ 62%`. If you later allow a free color
  picker, compute `--accent-on` as black/white by luminance and warn below the AA threshold.

### 5.3 Density selector [EXACT]

Add **Settings → Appearance → Density** as a 3-way segmented control (reuse the theme
toggle's radiogroup pattern):

| Option | `--density` | Effect |
|---|---|---|
| Dense | `0.85` | today's feel, tighter |
| **Normal** (default) | `1` | the new default |
| Spacious | `1.25` | generous touch-friendly spacing |

Because all spacing + `--row-mail` derive from `--density` (§5.1), one variable reflows the
whole app. Persist alongside theme/accent.

♿ **a11y:** never let Dense push interactive targets below 44px on coarse pointers — the
`Button`/`Input` `@media (pointer: coarse) { min-height: 44px }` rules already guarantee this;
keep them and do **not** multiply those minimums by `--density`.

### 5.4 Modernize the type scale [DIRECTION]

Current scale tops out at `--text-xl: 1.714rem` (~24px) and leans on `system-ui`. Keep
`system-ui` (fast, native, dependency-free, future-forward) but:

- Raise default body to **15px** at Normal density (`--text-base` driven off density is
  optional; simplest is a fixed 15px base + density on spacing only).
- Add `--text-2xl`/`--text-3xl` for view titles so headings stop colliding with body weight.
- Adopt `text-wrap: balance` on headings and `text-wrap: pretty` on body/preview text.

---

## 6. Global layout & pane structure (P0)

### 6.1 The overlapping-text bug in the message list [EXACT] [P0]

**This is the "overlapping text on the message list" you flagged.** In
`views/thread-list.tsx`:

- `ROW_HEIGHT_PX = 64` (line ~71) and the virtualizer `estimateSize: () => ROW_HEIGHT_PX`
  (line ~163).
- Each row renders **three lines** — (sender + date), (flag + subject), (preview) — plus
  `padding: '0.5em 0.75em'` (rows ~395–410).
- At 14px base / line-height 1.5, three lines ≈ 63px **plus** ~16px vertical padding ≈ **79px**
  of content forced into a **64px** absolutely-positioned row. Content overflows into the
  next row → the overlap.

**Fix (pick one):**

- **A — taller rows (recommended):** set `--row-mail` and the JS row height to the real
  content height. With density: `const ROW = parseInt(getComputedStyle(...).getPropertyValue('--row-mail'))`,
  or simpler, bump the constant to **84** and keep `estimateSize` in lockstep. The virtualizer
  height and the rendered row height **must always match** or rows will overlap again.
- **B — two-line rows:** drop the standalone preview line into a single truncated line that
  combines subject + " — " + preview, keeping rows at ~56–64px. Denser, fewer lines.

**Recommendation:** A, with row height derived from `--row-mail` so density changes don't
re-introduce the overlap. Also switch the virtualizer to **dynamic measurement**
(`measureElement`) so future content changes can't desync the height again.

♿ **a11y:** the visually-hidden read/flag summary (`thread-list.tsx:~470`) is good — keep it.
Ensure the row remains a single `role="option"` after restructuring.

### 6.2 Unclear pane demarcation [EXACT] [P0]

**This is the "unclear demarcation between panes" you flagged.** `MailLayout`
(`App.tsx:~880`) renders both the thread list and thread view as bare `<section>`s inside a
grid with only `gap: 1em` (`layout.module.css:.mailGrid`). Both sit on `--surface-1` with no
border, background, or header chrome → they blur together.

Fix:

- Give the **list rail** `background: var(--surface-2)` and a `border-right: 1px solid
  var(--border)`; give the **reading pane** `background: var(--surface-1)`. The surface step
  is what the eye reads as "two panes."
- Each pane gets a **sticky header bar** (list = mailbox name + count + toolbar; reading =
  subject + actions) with a `border-bottom: 1px solid var(--border)`, so the scroll region is
  visually bounded.
- Replace the magic `height: '70vh'` scroll container (`thread-list.tsx:~326`) with a proper
  full-height flex column: panes are `display:flex; flex-direction:column; min-height:0`, and
  only the list/message body scrolls (`flex:1; overflow-y:auto`). Today the list scrolls at
  70vh while the reading pane scrolls the page — two different scroll models in one screen.
- Mirror the **`contacts-view.module.css`** structure (`.container` / `.listPane` /
  `.detailPane` with `min-height:0; overflow:hidden`) — it already solves exactly this layout
  correctly. Reuse that pattern for mail.

### 6.3 Navigation active-state is invisible [EXACT] [P1]

In `sidebar.module.css`, `.navItemActive` uses `background: var(--surface-3)` — **identical to
`.navItem:hover`**. So the current view isn't distinguishable from a hovered one. Fix:

```css
.navItemActive {
  background: var(--accent-subtle);
  color: var(--text-1);
  font-weight: 600;
  box-shadow: inset 3px 0 0 var(--accent);   /* accent rail = "you are here" */
}
```

This is also the first deliberate, attractive use of orange (§9). ♿ keep `aria-current="page"`
(already present).

### 6.4 No dead clicks: default selection + never-empty panes [EXACT] [P0]

Two concrete defects you flagged:

- **Clicking "Mail" shows nothing in the reading pane.** Root cause: the inbox is never
  auto-selected in the live shell. The auto-select-inbox effect exists *only* in the orphaned
  `views/mailbox-list.tsx` (it picks the `role === 'inbox'` mailbox), and the `Sidebar` path
  the shell actually renders doesn't run it — so `selectedMailboxIdAtom` stays `null`,
  `ThreadList` shows "Select a mailbox," and `ThreadView` shows "Select a thread." The user
  lands on a blank screen.
  **Fix:** when entering the mail view (or when mailboxes first load), default
  `selectedMailboxIdAtom` to the inbox (or the first mailbox in display order) if it's null —
  port the effect from `mailbox-list.tsx` (which you're adopting anyway, §10). The thread list
  then populates immediately, and the reading pane shows a proper *no-selection* state instead
  of nothing.
- **Every pane must always render a *state*, never blank.** Define explicit states per pane —
  **loading** (`Skeleton`), **empty** (`EmptyState`: icon + one-line guidance), **content**,
  and for the reading pane a **no-selection** state ("No conversation selected — pick a message
  from the list"). Today these are bare `<p>` strings or nothing. Wire the existing
  `EmptyState`/`Skeleton` components (§4.2). Switching to Calendar/Contacts/etc. must likewise
  render the view or its empty state — never an unstyled "coming soon" or blank region (the
  dead `PlaceholderView` in `App.tsx:~940` should go, §10).

The mockup demonstrates all of this: open it, click **Trash** (designed empty state), click a
row (reading pane fills), click **Calendar / Settings** (a view panel renders). No click is a
dead end.

### 6.5 Collapsible folder tree [EXACT] [P1]

The sidebar mailbox list (`sidebar.tsx` → `MailboxTreeItem`) is **not collapsible** — nested
mailboxes are always expanded and the folder section can't be hidden. Adopt the WAI-ARIA tree
from `views/mailbox-list.tsx` (§10), which already implements the behavior:

- a disclosure caret per parent mailbox with `aria-expanded` and ▸/▾ rotation;
- `ArrowRight`/`ArrowLeft` expand/collapse, `ArrowUp`/`ArrowDown` move, `Home`/`End` jump, with
  roving tabindex (it's all in that file already — it's just not wired into the shell).

Add one affordance on top: a collapse toggle on the **"Mail" section row itself** so the whole
folder list can be hidden to reclaim sidebar space, and **persist** the open/closed state
(per-parent and section-level) in the prefs store so it survives reload. ♿ every caret is a
real `<button>` carrying `aria-expanded` and an `aria-label` ("Collapse Inbox").

---

## 7. Inbox / Thread List — missing furniture (P0/P1)

Beyond the overlap fix (§6.1), the list is missing the standard mail affordances. These are
the "missing common UI elements / missing CRUD" items you flagged.

### 7.1 A list toolbar [DIRECTION] [P1]
Add a sticky toolbar above the rows with: select-all checkbox, and (when ≥1 selected)
**Archive · Delete · Mark read/unread · Move to…**, plus an always-visible **Refresh** and a
sort/filter affordance. Use `Button variant="ghost" size="sm"` with leading icons (the
sidebar already defines an icon style).

### 7.2 Per-row hover actions [DIRECTION] [P1]
On row hover/focus, reveal a trailing action cluster — **Archive, Delete, Mark read, Flag** —
as ghost icon buttons. Use `:has()`/`:hover`/`:focus-within` so they appear without JS state.
On coarse pointers, show a single overflow (`⋯`) opening a menu (the actions must be reachable
without hover). ♿ each action needs an `aria-label` including the subject
(e.g. `aria-label="Archive: <subject>"`), and must be focusable in the roving-tabindex model.

> **CRUD reality check:** the code comments note `x to mark read` and other mutations are
> "deferred — needs `mail.modify`" (`thread-list.tsx:~24`). The brief's capability vocabulary
> already includes `mail:modify` and `mail:delete`. **Design and build the affordances now**
> with optimistic UI + the propose/preview/commit path; wire them to the capability as it
> lands. Don't let the missing capability hide the buttons — that's why common actions feel
> absent.

### 7.3 Read/unread + sender presence [EXACT] [P1]
- Unread today is conveyed *only* by `fontWeight: 600`. Add a **leading unread dot**
  (`8px`, `background: var(--accent)`) and keep the bold subject. Read rows: no dot, normal
  weight, slightly muted sender.
- Add a **sender `Avatar`** (the component exists) at the row's leading edge — initials or
  gravatar-style monogram. Huge scannability win, and it anchors the row's vertical rhythm so
  3 lines of text sit beside a 40px avatar instead of stacking awkwardly.
- The flag star (`★`, `thread-list.tsx:~445`) → a proper flag icon button (toggles
  `$flagged`), tinted `--accent` when set.

### 7.3.1 Avatar color = meaning, never random [EXACT] [P1]

The avatar/monogram color **must encode something** — a decorative random color is exactly the
kind of purposeless UI element to leave out. Use a deterministic, three-tier rule (no `Math.random`,
no rotating palette index):

| Sender class | Color | Why |
|---|---|---|
| **Agent** | `var(--accent)` | Your agents read as "action / mine"; tracks the accent picker live. |
| **Automated / system** (GitHub, CI, Stalwart Releases, Open Brain, no-reply) | `--badge-system` (muted neutral grey) | Low-signal machine mail recedes visually. |
| **Human contact** | a **stable hue derived from the address** — `hsl(hash(email) % 360, 46%, 50%)` | Same person → same color, forever. Real recognition/scannability value. |

Implementation:

- Classify the sender once (it maps cleanly onto the brief's actor model: human / agent /
  automated). A simple heuristic for "automated" (no-reply addresses, known service domains,
  missing personal name) covers most system mail; agent senders are already identifiable from
  the agent-identity metadata.
- **User/tool override:** let the user pin a color to a contact or a category (e.g. "all CI
  mail = grey", "finance = teal"), and let an agent/rule propose one (via the same
  propose/preview/commit path). The deterministic hue is only the *default* when nothing is
  assigned. Persist overrides in the prefs/annotations store.
- Initials are the fallback glyph; a real avatar image (gravatar/contact photo) supersedes the
  color fill when available.
- ♿ **a11y:** color is **never the only signal** — the monogram initials, the agent chip
  ("Agent · awaiting review"), and a `title`/`aria-label` naming the sender class carry the
  meaning for non-color users. Verify white-on-fill initials clear 4.5:1 at `l:50%` (they do
  for the hues above; clamp lightness if you widen the range).

The mockup (`mockups/iarsma-redesign.html`, `colorFor()`) implements exactly this rule — toggle
the accent picker and watch only the *agent* avatars move while human/contact colors stay put.

### 7.4 "Load more" / pagination [DIRECTION] [P1]
The list ships only the first page (`useThreadList`, ~50). The `position`/`total` fields are
already in the data shape. Add an infinite-scroll sentinel or a **Load more (N of M)** button
at the list end. Today reaching message 51 is impossible from the UI.

### 7.5 List header [EXACT] [P1]
The header literally says **"Threads"** (`thread-list.tsx:~316`) regardless of mailbox. Show
the **mailbox name** ("Inbox", "Sent", …) as the `<h2>`, with the `N of M` count as a muted
subtitle. The `ROLE_LABEL` map in `mailbox-list.tsx:~40` already canonicalizes these names —
reuse it.

---

## 8. Per-screen recommendations

### 8.1 Search bar (`App.tsx:~540`) [P1]
Currently an inline-styled bare `<input>` with a text "Search:" label, a text "Clear" button,
and the layout toggle, all hand-styled.
- Replace with `Input` (search variant), a leading magnifier icon, and an inline clear (`×`)
  affordance inside the field rather than a separate "Clear" word-button.
- Move it into the **list pane's sticky header** (§6.2), not floating above the whole content
  area. Make the placeholder honest about scope ("Search all mail").
- ♿ keep `aria-label`, the `Escape`-clears behavior, and the `/`-to-focus shortcut.

### 8.2 Reading pane / Thread View (`thread-view.tsx`) [P0 styling]
- Reply / Reply all / Forward (`thread-view.tsx:~300`) are unstyled native buttons → `Button`
  (`reply`=primary or secondary, the rest secondary/ghost). Pin them in a **sticky action bar**
  at the bottom of the reading pane, not inline after the body.
- Add the **message-level CRUD** that's absent: Archive, Delete, Move, Mark unread, Print —
  as a ghost icon row in the thread header (mirror §7.1).
- Message cards: the per-message `<article>` border/radius is inline (`thread-view.tsx:~250`)
  → a `.messageCard` module class on `--surface-1` with `--border`, and a clearer
  collapsed/expanded affordance (chevron, hover background).
- "External images blocked" notice (`thread-view.tsx:~360`) → a proper inline banner
  (shared `.notice` style, §8.8) with a `Button size="sm" variant="ghost"` "Show images",
  not a bare link-button.
- Stacked/mobile: add a **"← Back to list"** affordance; currently selecting a thread on a
  narrow screen leaves no obvious way back to the list (the grid just stacks).
- ♿ preserve the `n/p/e/r/R` keyboard model and `aria-expanded` on message headers.

### 8.3 Compose (`compose-view.tsx`) [P0 styling]
- All fields use inline `fieldStyle`; recipients/subject → `Input`. The `From` row → a styled
  `<select>` token-matched to `Input` (or a small custom listbox).
- **"Cancel" appears twice** — once in the header (`compose-view.tsx:~430`) and once in the
  footer. Make the header control a **close `×` icon button** (`aria-label="Close"`) and keep a
  single text **Cancel** in the footer; add a **Discard draft** destructive action (the brief
  anticipates `mail.draft.delete`).
- The native `<input type="file">` (`compose-view.tsx:~720`) → a styled **"Attach" `Button`**
  triggering a hidden input, with attachment chips below (the list markup is fine; restyle as
  chips with a remove `×`).
- The **Send preview modal** (`SendPreviewModal`, ~line 600) and the agent **Approvals** card
  (§8.7) are the *same* concept (preview-before-commit). Unify them into one **PreviewCard**
  treatment (§8.6).
- Reuse the shared `Dialog` component for the modal shell instead of the hand-rolled
  fixed-overlay `<div role="dialog">` — `Dialog` already handles backdrop, focus trap, and
  Escape. ♿ this removes a class of focus-management bugs.

### 8.4 Calendar (`calendar-view.tsx`, `calendar-view.module.css`) [P1]

Good coverage already (month/week/day, create/edit/detail/delete dialogs, `t/m/w/d` + arrow
shortcuts, all on `Button`/`Dialog`). Gaps that hurt clarity:

- **[EXACT] Kill the blue fallback.** `EventBlock` sets `borderColor = event.calendarColor ??
  'var(--accent, #3b82f6)'` — the same stray non-brand blue as §4.2. Drop the `#3b82f6`.
- **[DIRECTION] Month cells should show event *chips*, not dots.** Today a busy day is three
  anonymous colored dots + “+N” (`styles.eventDot`), which hides *what's* happening. Render
  titled, colored chips (time + title, truncated) and fall back to a “+N more” row; reserve
  dots for the densest breakpoints only. This is the single biggest readability win for the
  calendar.
- **[DIRECTION] Add a calendar list / visibility rail.** `calendarColor` exists but there's no
  way to see or toggle calendars. Add a left rail (or popover) listing calendars with their
  color swatch + a show/hide checkbox — essential once there's more than one calendar (and the
  brief expects agent-scheduled calendars).
- **[EXACT] View switcher → `SegmentedControl`.** The Month/Week/Day buttons
  (`styles.viewToggleBtn`) are a hand-rolled active-class group — replace with the shared
  segmented control (§12) so it matches the density/theme/approval toggles.
- **[DIRECTION] Week/Day ergonomics.** 24 rows always render with no current-time line and no
  default scroll — add a **“now” indicator** and scroll to ~8am on open. Render **all-day**
  events (`P1D`) in a dedicated all-day strip at the top, not in the 00:00 slot.
- **[DIRECTION] Make event creation discoverable.** Creation is double-click only
  (`onDoubleClick`) — add a single-click “+” affordance on slot hover and keep double-click.
- **[DIRECTION] Agent/tentative events read distinctly.** `status: 'tentative'|'cancelled'`
  currently just lowers opacity; give tentative an outline/hatched fill and surface
  agent-created holds with the agent treatment (§7.3.1) so “your scheduling agent booked this”
  is legible.
- **[EXACT] Header layout.** The header crams view-toggle + New Event + month label + nav in
  one row. Reorganize: **left** = month label + `‹ Today ›`; **right** = segmented view
  control + `+ New Event` (primary). Header reads cleaner and matches the reading-pane bar.
- ♿ Month grid is keyboard-navigable per *period* only (prev/next). Add **roving focus across
  day cells** (Arrow keys move cell-to-cell, Enter opens/creates) — the cells are already
  `role="button"` with labels, they just need the roving model. Loading → a skeleton grid, not
  “Loading calendar…”. Migrate the module's hardcoded `em` sizes onto the density tokens (§5.3).

### 8.4.1 Contacts (`contacts-view.tsx`, `contacts-view.module.css`) [P2]

The healthiest view — `Avatar`/`Button`/`Dialog`/`Input`, a clean two-pane module that is the
**reference** for the mail-pane refactor (§6.2). Polish:

- **[EXACT] Avatar color = the contact identity hue** (§7.3.1). `Avatar name={name}` should use
  the same deterministic human-hue rule as mail so a person is the same color everywhere.
- **[DIRECTION] Message-this-contact in one click.** The detail pane only offers Edit/Delete.
  Add primary actions — **Message** (opens Compose prefilled to them), **New event with**,
  **Call** — honoring the brief's symmetric-surface idea. This is the most-wanted missing
  action in Contacts.
- **[DIRECTION] Alphabetical sections** with sticky letter headers in the list for fast
  scanning once the list is long.
- **[EXACT] Use `Input` for the search field** (it's a raw `<input className=searchInput>`
  today) and **`EmptyState`** (icon + “Add your first contact” CTA) instead of the plain
  `<p>No contacts found.</p>`.
- ♿ Confirm the single-column mobile flow has a **back affordance** (same gap as mail §8.2).

### 8.4.2 Files (`files-view.tsx`) [P2]
Good use of `Skeleton`/`EmptyState`. The inline commit-message `<textarea>`
(`files-view.tsx:~577`) → an `Input`-styled textarea for consistency.

### 8.5 Activity log (`activity-view.tsx`) [P1]
The brief makes this an **inbox-adjacent, first-class surface** (“not buried in a settings
panel”), but it's currently the most ad-hoc view: module-level `thStyle`/`tdStyle`/`selectStyle`/
`badgeBaseStyle`, a native filter bar, native pagination, native expand buttons, and raw
`<pre>JSON</pre>` detail. It also renders with `entries={[]}` hardcoded in `App.tsx:~790` —
it's effectively a **stub with no data wired**. Bring it up to first-class:

- **[EXACT] Real data + components.** Wire actual action-log entries (stop passing `[]`). Move
  the integrity states to `Badge` (`success`/`destructive`/`warning` intents exist in tokens);
  filter selects → styled `Input`/select; pagination → a shared `Pagination`/`Button`; mode
  (`preview`/`commit`) and `callerClass` (`ui`/`mcp`/`agent`/`library`) → `Badge`s.
- **[EXACT] Table → `*.module.css`.** Zebra striping via `:nth-child` + `color-mix`, not the
  inline `bgColor` per row; borders via `--border`.
- **[DIRECTION] Actor column carries identity.** Show an **avatar + name + kind** (human /
  agent / system, §7.3.1) so you can scan *who* — person vs agent — at a glance. This is the
  whole point of an agent-collaboration audit log.
- **[DIRECTION] Undo for reversible actions.** The brief explicitly wants “undo recent actions
  where reversible (move-back, unsend within window, restore deleted).” Add an **Undo** action
  on eligible rows, and let the user filter by **affected resource** and jump from an entry to
  the thread/contact/event it touched.
- **[DIRECTION] Detail panel, not a JSON dump.** Replace the raw `<pre>` with a structured
  detail (params as labeled rows; provenance + hash chain in a monospace block with **copy**
  buttons). Keep “view raw JSON” as a secondary toggle.
- ♿ Verify action → a real `Button`; announce the result via an `aria-live` region. Expanders
  use a chevron with `aria-expanded`.

### 8.6 Unify previews/confirmations into one PreviewCard [DIRECTION] [P1]
Create a single component used by: Compose's send confirmation, the agent Approvals queue, and
any future destructive confirmation (delete/move). It renders the structured preview
(recipients, subject, body preview, effects, estimated size/time) consistently. This is the
brief's propose/preview/approve/commit pattern made visible as one reusable surface, and it
removes three divergent ad-hoc modals.

### 8.7 Approvals (`approvals-view.tsx`) [P1]
The approval queue is a flagship agent-collaboration surface, but today it's inline-styled
native buttons + a raw-JSON preview. Make it feel first-class:

- **[EXACT] Components.** Approve → `Button variant="primary"` (or a success variant); Deny →
  `variant="destructive"`; preview toggle → `ghost`; card → `Card`; tool/scope tags → `Badge`;
  tab filter → the shared `SegmentedControl` (§12). Replace `cardStyle`/`badgeStyle`/
  `approveButtonStyle`/`denyButtonStyle` module-level objects.
- **[DIRECTION] Agent identity is front-and-centre.** Lead each card with the requesting
  agent's **avatar (accent) + name + the scopes this action uses** (`Badge`s), and a
  relative time (the existing `relativeTime` helper is good — keep). The reader should know
  *which agent* wants *what authority* before reading the diff.
- **[DIRECTION] Readable preview, not `JSON.stringify`.** The brief's whole model is
  propose→**preview**→approve→commit; the preview must say *what would change* in human terms
  (e.g. “write `docs/x.md` (+12/−3 lines)”, “move 3 messages to Archive”). Use the unified
  **PreviewCard** (§8.6); keep “view raw JSON” as a secondary disclosure.
- **[DIRECTION] Connect it to the rest.** Add **“Open in Activity”** on each card (the action
  lands in the log on commit), surface the **pending count as the sidebar badge** (already in
  the nav), and consider **bulk approve/deny** for a trusted agent.
- ♿ Approve/Deny already disable while acting — keep that; add an `aria-live` confirmation
  (“Approved — committed to the action log”) and a brief **undo window** where reversible.

### 8.8 Shared notice / banner styles [EXACT] [P1]
Error/alert/notice strings are re-implemented inline everywhere (`errorStyle` in compose,
`role="alert"` divs in files-view/files-settings-panel using
`color-mix(in srgb, var(--destructive) 10%, transparent)`). Promote to shared module classes:
`.notice`, `.noticeError`, `.noticeWarning`, `.noticeSuccess`, each `border-radius:
var(--radius-md)`, `padding: var(--space-sm) var(--space-md)`, tinted via `color-mix` on the
matching token. ♿ keep `role="alert"` on error variants.

### 8.9 Signed-out / sign-in (`signed-out-view.tsx`) [P1]
The first screen every user sees is bare: an `<h1>Iarsma</h1>`, a paragraph, and an unstyled
"Sign in with Stalwart" button. Give it the same care as the marketing page: centered card,
the Iarsma wordmark, a one-line value prop, `Button variant="primary" size="lg"`, and the
error in a `.noticeError` banner. This is also where the **brand color mismatch** is most
visible (§9).

### 8.10 Mobile chrome [P1]
`TopBar` (tablet/mobile) has an `.actions` slot that's unused — surface Search and Compose
there on mobile. `BottomNav` is fine; verify it reflects the same active-state treatment as
§6.3. Ensure the reading pane has the §8.2 back affordance on mobile.

### 8.11 Settings (`agent-settings-view.tsx`) [P1]
Today “Settings” is a single scroll containing the GitHub-files panel, an **Issue Token** form
(native input + checkbox fieldset + native select), and an **Active Tokens** HTML table — all
inline-styled, with two stacked `<h2>`s (“Settings” then “Agent Tokens”). It needs structure:

- **[DIRECTION] Give Settings a real shape: a left sub-nav + content panel.** Sections:
  **Appearance** (theme + accent + density — the canonical home for §5, mirrored from the
  sidebar footer), **Identities** (sending identities), **Agent tokens**, **Files / GitHub**,
  **Account** (email, sign out). This replaces the flat scroll and gives the appearance
  controls a discoverable home.
- **[EXACT] Forms on the system.** Agent-name field → `Input`; lifetime → a styled `select`
  or `SegmentedControl`; the scope `fieldset` → a grouped checkbox/chip control. Submit →
  `Button variant="primary"`. The issued-secret reveal → a `Notice` (warning) with the secret
  in a monospace, **mask-by-default + reveal**, copy-to-clipboard field (the copy affordance
  exists — restyle it).
- **[EXACT] Tokens table.** Reuse the shared table style (with Activity, §8.5); scope cells →
  `Badge`s; status → `Badge` (`success` Active / neutral Revoked); Revoke → `Button
  variant="destructive" size="sm"` behind a confirm `Dialog`.
- **[DIRECTION] Per-agent context (brief: “per-agent dashboards … and a kill switch”).** Show
  **last used** per token, link each row to its **Activity** filter, and expand the scope
  vocabulary beyond mail (`calendar:*`, `contacts:*`, `files:*`, `memory:*` per the brief),
  **grouped by domain** rather than a flat checkbox row.
- ♿ Every field keeps a real `<label>`; the revoke/issue results announce via `aria-live`.

---

## 9. Making orange clean, clear, and attractive [DIRECTION]

You want to keep orange but applied with intent. Today orange barely appears — and where it
does, it's inconsistent: the active nav item is *grey* (§6.3), the layout toggle even falls
back to *blue* (`#3b82f6`, §4.2). Principles for a confident, restrained orange:

1. **Orange is for action and "live," not decoration.** Reserve `--accent` for: the primary
   button, the active-nav rail, unread dots, the focus ring, links, and selection. Don't tint
   large surfaces orange.
2. **One strong orange, plus tints — never a second saturated hue.** Use `--accent` at full
   strength on small elements; use `--accent-subtle` (12% mix) for the active-nav background,
   hover wells, selected-row tint. This is what reads as "designed" rather than "default."
3. **Derive states by lightness, not by a new hex** (§5.1) — so hover/active feel like the
   *same* orange pressed, not a different swatch.
4. **Earn contrast.** `--accent-on: #fff` on `--accent` at `l:60%` clears AA for large text;
   for small text on orange prefer `--accent-active` (darker) or use `--text-1` on
   `--accent-subtle`. The mockup demonstrates compliant pairings.
5. **Neutomatic warmth.** Optionally warm the neutrals a hair (surfaces toward `hsl(30 …)`)
   so the greys feel related to the orange rather than clinically cool. Subtle; test in dark
   mode.

The accent picker (§5.2) means orange is the *default identity* but never a lock-in — which
also resolves the app-orange vs marketing-green tension: the app can ship Ember by default and
let the user (or a future marketing-aligned theme) choose otherwise.

---

## 10. Orphaned / duplicated UI to resolve [P1]

- **`components/command-palette.tsx` is built but never mounted.** It's a complete command
  palette (query + roving selection) with no consumer (`grep CommandPalette` finds only its
  own definition). Wire it to a `⌘K`/`Ctrl-K` shortcut (the global keyboard handler in
  `App.tsx:~1080` is the place) and feed it nav + common actions. This single move adds a
  major "missing common UI element" you flagged, with code that already exists.
- **Two mailbox trees.** `views/mailbox-list.tsx` is a full WAI-ARIA tree (expand/collapse,
  arrow-key nav, roving tabindex) but appears **orphaned** — the shell renders the simpler
  inline `MailboxTreeItem` inside `sidebar.tsx` instead. Decide one: either adopt
  `mailbox-list.tsx`'s richer a11y tree inside the sidebar, or delete it to remove the
  divergence. Recommendation: **adopt the ARIA tree** (better keyboard story, matches the
  brief's a11y bar) and delete the inline duplicate.
- **`PlaceholderView` "coming soon"** (`App.tsx:~940`) is unreachable dead code now that all
  views exist — remove.

---

## 11. Prioritized roadmap

### P0 — broken or blocks daily use (do first)
1. **Fix message-list row overlap** (§6.1) — row height vs virtualizer estimate.
2. **Establish pane demarcation + a single scroll model** (§6.2).
3. **Adopt the design system in ThreadList / ThreadView / Compose** (§4, §8.2, §8.3) — swap
   native elements for `Button`/`Input`/`EmptyState`/`Skeleton`, move inline styles to
   `*.module.css`.
4. **No dead clicks** (§6.4) — default the inbox selection so opening Mail populates the list,
   and give every pane an explicit loading / empty / no-selection / content state.

### P1 — clarity & consistency
4. Token refactor for derivable accent + density (§5.1) → **Accent picker** (§5.2) +
   **Density selector** (§5.3).
5. List toolbar + per-row actions + unread dots + avatars + "Load more" + real list header
   (§7).
6. Active-nav treatment (§6.3); kill the stray blue fallback (§4.2).
7. Search bar into the list header, on `Input` (§8.1).
8. Unify previews/confirmations → PreviewCard; restyle Approvals & Activity (§8.5–8.7).
9. Shared notice/banner styles (§8.8); sign-in screen (§8.9); mobile chrome (§8.10).
10. Mount `CommandPalette`; resolve the duplicate mailbox tree (§10).
11. **Collapsible folder tree** + persisted expand/collapse state (§6.5), via the adopted
    ARIA tree.

### P2 — polish
11. Type-scale modernization, `text-wrap` (§5.4).
12. Calendar/Contacts/Files light polish (§8.4).
13. Warm-neutral tuning + dark-mode contrast pass (§9).

---

## 12. New / extended components to add

To support the above, add these to `components/` (keeping the CSS-Modules pattern):

- **`SegmentedControl`** — used by theme toggle, density selector, approval tabs, layout
  toggle (replaces 4 hand-rolled radiogroups).
- **`IconButton`** — ghost square button for toolbars/row actions; wraps `Button` with a fixed
  square size + required `aria-label`.
- **`PreviewCard`** — the propose/preview surface (§8.6).
- **`Toolbar`** — sticky pane-header bar (list + reading).
- **`Notice`** — the banner family (§8.8).
- **`Menu`** — for overflow (`⋯`) actions on touch (§7.2).

Each is small, dependency-free, and composes the existing tokens — consistent with the §3.1
strategy.

---

## 13. Appendix — exact token diff summary

Apply in `styles/tokens.css`:

- **Add** `--accent-h/s/l`, derive `--accent`, `--accent-hover`, `--accent-active`,
  `--accent-subtle`, `--accent-on` (§5.1). Replace the flat `--accent-hover: #ff9d23`.
- **Add** `--border`, `--border-strong` (§5.1) and migrate `1px solid var(--surface-3)` usages
  to `var(--border)`.
- **Add** `--density` and rebase `--space-*` + new `--row-mail` on it (§5.1, §5.3).
- **Add** `--text-2xl`, `--text-3xl`; raise base to 15px (§5.4).
- **Mirror** all new accent/border tokens inside the `[data-theme="dark"]` block (the derived
  HSL accent works in both themes; only `--accent-on` and `--border-strong` may need a dark
  override).
- **Remove** the `var(--accent, #3b82f6)` blue fallback in `layout.module.css`.

---

*End of spec. See `mockups/iarsma-redesign.html` for the visual target with live accent +
density controls.*
