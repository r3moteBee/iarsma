# Going Public — Iarsma Repo Migration Guide

Step-by-step for flipping `r3moteBee/iarsma` from private to public, configuring it for the open-source life, and re-enabling CI gates that need a public repo (or paid plan) to enforce.

---

## Status (as of 2026-05-09 audit, PR-8)

The repo is already **PUBLIC**. Phases 1–3 of this checklist were re-run after the fact to confirm clean state. Findings below.

### Executed and clean

| Step | Status | Notes |
|---|---|---|
| 1.1 Secrets scan | ✅ Clean | All six grep patterns return empty across `git log --all`. |
| 1.2 `.env` in history | ✅ Clean | No `.env*` files committed (excluding the safe `.env.example` template). |
| 1.2 `.env.example` review | ✅ Clean | Placeholder values only (`sw-mail.example.net`, empty secrets). |
| 1.3 `.gitignore` discipline | ✅ Clean | `.env`, `.env.*.local`, `*.key`, `*.tsbuildinfo` all listed. |
| 1.4 License files | ✅ Present | `LICENSE-MIT` + `LICENSE-APACHE` both at the repo root. |
| 1.5 README scan | ✅ Pass | Concise pitch + quickstart + license; nothing surprising for a stranger. |
| 1.7 Public DNS reference | ✅ OK | `sw-mail.r3motely.net` is already public. |
| 2 Visibility flip | ✅ Done | `gh repo view` reports `visibility: PUBLIC`. |
| 3.1 About + topics | ✅ Done | Description + `iarsma.io` homepage + 14 topics set. |
| 3.2 Branch ruleset | ✅ Active | "main protection" enforces required CI checks (TypeScript / Rust / Shell bundle), blocks deletion + force-push. Bypass actor: admin role with `always` mode. |
| 3.3 Unlimited Actions | ✅ Confirmed | CI runs freely; no minute meter visible. |
| 3.4 `SECURITY.md` | ✅ Committed | At repo root; private vulnerability reporting enabled. |

### Findings — operator follow-ups (not in PR-8)

These need the user's hands or are GitHub-UI / git-config concerns the audit can't fix from a workspace PR.

1. **Local git committer identity on the dev VM.** The OCI VM that hosts development auto-detects committer identity as `Ubuntu <ubuntu@sw-mail.r3motely.net>`. Squash-merged commits on `main` are clean (`r3moteBee <brent@r3motely.com>` as author, `GitHub <noreply@github.com>` as committer), but stray PR-branch commits carry the auto-detected identity. Set explicitly on the VM:
   ```bash
   git config --global user.name "Brent Ellis"
   git config --global user.email brent@r3motely.com
   ```
   Per `CLAUDE.md`, automated tooling never touches the git config; only the operator does.

2. **Stale remote branches.** Five squash-merged feature branches still exist on `origin` (their commits are not reachable from `main`):
   - `add-security-policy`
   - `feat/action-log-scaffold`
   - `feat/discovery-urn-scaffold`
   - `feat/jmap-client-session-get`
   - `feat/oauth-and-login`

   These predate the 2026-05-09 audit-driven PRs (#17–#23, all of which used `gh pr merge --squash --delete-branch`). Cleanup is destructive on the remote, so it's left to the operator:
   ```bash
   for b in add-security-policy feat/action-log-scaffold feat/discovery-urn-scaffold \
            feat/jmap-client-session-get feat/oauth-and-login; do
     git push origin --delete "$b"
   done
   git fetch --prune origin
   ```
   Or, on the GitHub UI, Settings → Branches → delete each. Not a security concern (their commits aren't on `main`), just hygiene.

3. **Phase 3.5 optional polish — outstanding by choice.** The audit doesn't push to enable any of these; they're individual judgment calls.
   - Pin `iarsma` to the GitHub profile.
   - `CODE_OF_CONDUCT.md` (Contributor Covenant template).
   - `CONTRIBUTING.md` (one paragraph: how to run tests + the decisions-log discipline).
   - Social preview image (skip until there's a logo).
   - Dependabot security updates — currently not enabled (the `vulnerability-alerts` API returned 404 against the audit token). Worth flipping on at Settings → Code security and analysis once the project has a few dependencies that matter.

The "Phase 1 / 2 / 3" sections below are preserved as-is so the procedure remains the canonical reference for any future re-flip (e.g., after a `make private` round-trip).

---

## Phase 1 — Pre-flight checks (10 minutes)

The git history of a private repo becomes the git history of the public repo. **Anything you've ever committed becomes visible**, even if you later "delete" it — git history is permanent.

Run these one by one and confirm clean output for each.

### 1.1 Search for accidentally-committed secrets

```bash
# Run from the repo root (wherever you cloned it).

# Common secret patterns. Empty output = clean. Hits = needs investigation.
git log -p --all | grep -iE 'github_pat_[A-Za-z0-9_]{20,}' | head
git log -p --all | grep -iE 'sk-[A-Za-z0-9]{20,}'                   | head
git log -p --all | grep -iE 'AKIA[A-Z0-9]{16}'                      | head
git log -p --all | grep -iE 'client_secret\s*[:=]\s*"[^"$]+"'        | head
git log -p --all | grep -iE 'password\s*[:=]\s*"[^"$]+"'             | head
git log -p --all | grep -iE 'authorization:\s*bearer\s+[A-Za-z0-9._-]+' | head
```

Any non-empty output is a real concern. If you find one, **STOP** and tell me what came up; we'll either rewrite history with `git filter-repo` (clean but fiddly) or rotate the secret (simpler — invalidates the leaked credential so it's worthless anyway).

### 1.2 Check for `.env` files in history

```bash
# Look for env files added at any point — but exclude the safe template `.env.example`
git log --all --diff-filter=A --name-only \
    | grep -E '(^|/)\.env($|\.)' \
    | grep -v '\.example$' \
    | head
```

Empty = good. If a real `.env`, `.env.local`, `.env.production`, etc., was ever committed, that file's contents are public history forever (even if it was deleted later in a normal commit).

`.env.example` is *meant* to be committed — it's a placeholder template documenting what env vars the project expects. Verify it has only placeholders, no real secrets:

```bash
grep -v '^#' .env.example | grep -v '^$'
```

You should see only var names with empty `=` or obviously fake values (`sw-mail.example.net`, `s3cr3t`, etc.) — never real credentials.

### 1.3 Verify `.gitignore` covers the right things

```bash
grep -E '\.env|secret|key|tsbuildinfo' .gitignore
```

Should show: `.env`, `*.key`, `*.pem`, `*.tsbuildinfo`. We already set this up.

### 1.4 Confirm license files

```bash
ls -la LICENSE-MIT LICENSE-APACHE
```

Both must exist. They do — we wrote them in F-1.

### 1.5 Glance at the README

Open `README.md` and scan it as if you were a stranger landing on the repo's GitHub page. It's the first thing visitors see. Today's README is in good shape (concise pitch, quickstart, license).

### 1.6 Check the commit-author identity

```bash
git log --all --format='%an <%ae>' | sort -u
```

You should see only addresses you're comfortable being public. Brent's `brent@r3motely.com` is fine since it's already on `r3motely.com`.

### 1.7 Check Stalwart admin URLs and similar

The reference deployment URL `sw-mail.r3motely.net` appears in `docs/`. That's already-public DNS, no security risk — just acknowledging it'll be visible.

---

## Phase 2 — The flip itself (1 minute)

1. Open the repo in your browser: <https://github.com/r3moteBee/iarsma>
2. Click **Settings** (top-right of the repo navigation, next to "Insights")
3. Scroll all the way to the bottom — there's a section called **"Danger Zone"**
4. Find the row **"Change repository visibility"**
5. Click **"Change visibility"**
6. Select **"Make public"**
7. GitHub will ask you to type the repo name (`r3moteBee/iarsma`) to confirm — type it exactly
8. Click **"I understand, change repository visibility"**

That's it. The repo is now public. Anyone can clone, view issues, see commit history, fork, etc.

---

## Phase 3 — Configure for open-source life (15 minutes)

### 3.1 Fill in the repo description

The right sidebar of the repo's main page has a small gear icon next to **About**. Click it and add:

- **Description:** _(paste the polished one from the docs)_
  > JMAP webmail where agents can be colleagues without chaos — built-in capability scoping, dry-run evaluation, and tamper-evident auditing.
- **Website:** `https://iarsma.com` (or `https://iarsma.io` — whichever you'd rather expose first)
- **Topics:** add these tags for discoverability:
  - `jmap` `webmail` `mail` `mcp` `agents` `wasm` `wasm-component-model` `oauth2` `pkce` `self-hosted` `tauri` `react` `typescript` `rust` `model-context-protocol`

Save.

### 3.2 Set up the Branch Ruleset (now free for public repos)

Settings → Rules → Rulesets → **New branch ruleset**:

- **Ruleset name:** `main protection`
- **Enforcement status:** `Active`
- **Bypass list:** **Add bypass** → search for your username `r3moteBee` → mode `Always` (lets you push directly when CI itself is broken — every bypass is logged)
- **Target branches:** **Add target** → `Include default branch`
- **Branch rules** — check these:
  - ✅ **Restrict deletions** (prevents accidentally deleting `main`)
  - ✅ **Block force pushes**
  - ✅ **Require status checks to pass**
    - ✅ **Require branches to be up to date before merging**
    - **Add checks** → search and add all three:
      - `TypeScript (typecheck + tests)`
      - `Rust (fmt + check + test)`
      - `Shell bundle (Vite build smoke)`
- Skip everything else for now (PR-required, signed commits, etc.) — you can layer those later.

Save.

**What this gets you:** any push that breaks CI is rejected at GitHub's edge before landing on `main`. You (as bypass actor) can override when needed; everyone else (including future contributors) gets the gate.

### 3.3 Verify Actions are still running with public-repo benefits

Go to the repo's **Actions** tab. The next push should run with **unlimited minutes** (vs the 2000/mo cap on private). No action needed — GitHub flips the meter automatically.

### 3.4 Add a `SECURITY.md` (recommended for public repos)

People who find security issues need a way to report them privately rather than as a public issue. Create the file:

```bash
cat > SECURITY.md <<'EOF'
# Security Policy

## Reporting a vulnerability

Please report security issues privately via GitHub's [private security advisory](https://github.com/r3moteBee/iarsma/security/advisories/new) feature, **not** as a public issue. This lets us coordinate a fix before disclosure.

You can expect an initial response within 5 business days.

## Supported versions

This project is in pre-alpha. Only `main` is supported; tagged releases will gain explicit support windows once they exist.

## Scope

In scope:
- The Iarsma application code in this repository
- The capability contract codegen pipeline
- The MCP server's auth and dispatch logic
- The token-exchange sidecar's OAuth flow

Out of scope:
- Vulnerabilities in upstream dependencies (report to those projects directly; we'll bump deps as fixes ship)
- Vulnerabilities in Stalwart Mail Server itself (report to <https://stalw.art>)
- Issues in the user's deployment configuration that aren't in our recommended docs
EOF
git add SECURITY.md
git commit -m "docs: SECURITY.md — private vulnerability reporting"
git push origin main
```

Once committed, GitHub auto-enables the **"Report a vulnerability"** button in the Security tab.

### 3.5 Optional polish (5 minutes, do later if you'd rather)

- **Pin the repo to your profile** — go to your GitHub profile → "Customize your pins" → select `iarsma`. Makes it the first thing people see when they visit your profile.
- **Add a CODE_OF_CONDUCT.md** — Settings → click "Add a code of conduct" link → use the Contributor Covenant template GitHub provides. Removes friction for first-time contributors and signals seriousness.
- **Add a CONTRIBUTING.md** — short doc explaining how to run tests, structure of PRs, decisions log discipline. Even one paragraph helps.
- **Add a social preview image** — Settings → General → Social preview → upload a 1280x640 image. Used when the repo is shared on Twitter/X, Mastodon, etc. Skip until you have a logo / aesthetic in mind.
- **Enable Dependabot security updates** — Settings → Code security and analysis → enable "Dependabot security updates". Auto-PRs when one of your deps has a known CVE.

---

## Phase 4 — What to expect after going public (FYI)

### Notifications you'll start getting

- **Stars** — random people starring the repo. You'll get an email per star unless you turn it off (Notification settings → "starring" → uncheck email).
- **Issues** — anyone with a GitHub account can open one. Be welcoming; for noise, use issue labels.
- **Pull requests** — same. You're under no obligation to accept any of them.
- **Mentions in commits** — search engines crawl GitHub; your repo will be discoverable in a few days.

### Things to be aware of

- **Spam PRs** are real. Bot PRs that "fix typos" with crypto-related additions, or PRs from sketchy accounts. Decline without comment; GitHub has a "block user" option.
- **Search visibility** is permanent. Even if you make the repo private later, the cached state in search engines persists for weeks.
- **Forks** are independent. Anyone can fork; their fork's changes don't affect your repo. Forks of public repos used to be searchable; they still are.
- **Repo-level secrets and webhook URLs stay private.** GitHub never exposes those, even on public repos. Settings → Secrets and variables → Actions secrets is owner-only.

### Things you can still do private after going public

- **Discussions** can be limited to maintainers only.
- **Issues** can be limited to "members only" (for orgs) but for personal repos, anyone can open them.
- **Security advisories** are private until you publish them.
- **You can flip back to private** anytime — Settings → Danger Zone → Change visibility → Make private. The history doesn't disappear from caches but no further public access.

---

## Troubleshooting

**"My repo isn't showing up in search."**
GitHub's search indexes public repos within 24-48 hours. If it's been longer, check Settings → General → "Discoverability" toggles.

**"Random people are commenting on my code."**
That's the deal. Use the "Block user" option for hostile actors, "Lock conversation" on threads going off the rails, and `CODEOWNERS` for code that needs your sign-off before merge.

**"CI ran out of free minutes!"**
Shouldn't happen on a public repo (unlimited minutes for public repos in 2026). If it does, check the Actions tab usage page.

**"I want to take it back private."**
Settings → General → Danger Zone → Change visibility → Make private. Note: existing forks stay public unless you contact GitHub support to ask them to remove specific ones.

---

## Done state

After Phase 3, you should have:

- ✅ Repo public at <https://github.com/r3moteBee/iarsma>
- ✅ "About" section filled in with description, website, topics
- ✅ Branch ruleset enforcing CI on `main` (with you as bypass actor)
- ✅ SECURITY.md committed
- ✅ Unlimited Actions minutes
- ✅ All future pushes gated by CI before they can land on main

When you're done, post here — I'll verify via the API that the rules are actually live, then we move to the JMAP client component.
