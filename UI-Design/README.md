# UI-Design

Design deliverables for the Iarsma webmail UI. **Design-only** — nothing here modifies
application or runtime code. It is a target for implementation and a candidate demo for the
iarsma site.

## Contents

```
UI-Design/
├── iarsma-ux-analysis.md      # the analysis / implementation spec
└── mockups/
    ├── iarsma-redesign.html   # open this in a browser
    ├── secondary-views.css    # companion (keep next to the HTML)
    └── secondary-views.js     # companion (keep next to the HTML)
```

- **`iarsma-ux-analysis.md`** — a structured UI/UX analysis + implementation spec for the React
  shell. Covers the design-system adoption gap, a derivable token & theming architecture
  (accent picker + Dense/Normal/Spacious density selector), per-screen recommendations (Inbox,
  Reading, Compose, Calendar, Contacts, Approvals, Activity, Settings), accessibility notes
  folded into each item, and a prioritized P0/P1/P2 roadmap.
- **`mockups/iarsma-redesign.html`** — a self-contained, clickable reference mockup built on the
  project's real design tokens. Demonstrates the redesigned 3-pane mail experience, compose
  modal, and all secondary views, plus live **accent**, **density**, and **theme** controls and
  a before/after toggle for the message-list fix.

## Viewing the mockup

Open `mockups/iarsma-redesign.html` in a browser — the three files in `mockups/` must stay
together (the HTML loads `secondary-views.css` / `secondary-views.js` by relative path). The
gray bar across the top is reviewer chrome (density / before-after toggles), not part of the
product UI.
