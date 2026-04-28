# Security Policy

Iarsma is a webmail client where humans and agents share the same surface. The trust model is not optional — capability scoping, the action log, and the auth flow are load-bearing. We take security reports seriously.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security reports.** Public disclosure before a fix is in place puts every self-hoster running Iarsma at risk.

Instead, report privately by emailing **security@iarsma.io**.

In your report, please include:

- A description of the issue and where it lives (component, file, or capability if you know).
- Steps to reproduce, or a proof-of-concept if you have one.
- The version, commit hash, or branch you tested against.
- Any thoughts on impact — what a malicious agent, malicious server, or malicious operator could do with this.

You can encrypt sensitive details with PGP if you'd like; a key will be linked here once published. If you'd rather report via a different channel, contact the maintainers privately first to arrange one.

## What to expect

- **Acknowledgment within 72 hours** that we received your report.
- **A triage update within 7 days** with our initial assessment (severity, affected versions, expected fix timeline).
- **Coordinated disclosure**: we'll work with you on a timeline. Default is up to 90 days from report to public disclosure, shorter for trivial fixes, longer if you and we agree more time is needed for a deep issue.
- **Credit** in the changelog and release notes for the fix, if you want it. We're happy to keep your report anonymous if you prefer.

## Scope

In-scope components (please report):

- The shell (`shell/`) — auth flow, capability invocation, dry-run handling.
- The token-exchange sidecar (`token-exchange/`) — anything that could leak the client secret, replay a code, or weaken the OAuth dance.
- The MCP server (`mcp-server/`) — scope enforcement, dispatch, and any way to call a capability you shouldn't be able to.
- Generated WASM components (when they land) — sandbox escapes, capability bypass, memory safety.
- The action log (when it lands) — anything that lets a committed action go unrecorded, or lets the chain be tampered with without detection.
- Any code path that accepts JMAP server responses and trusts them implicitly.

Out of scope (not security issues for this project):

- Vulnerabilities in Stalwart Mail Server itself — please report to the [Stalwart project](https://github.com/stalwartlabs/mail-server).
- Vulnerabilities in upstream dependencies — report to the relevant project. Once a CVE is public, we'll patch promptly; please flag it to us if we miss it.
- Misconfiguration of a self-hosted deployment (weak passwords, public S3 buckets, etc.) unless our docs led you there.
- Denial-of-service against a single self-hosted instance with attacker-controlled load — Iarsma is not an HA platform.
- Issues that require physical access to the user's device, or a compromised browser.

## Supported versions

Iarsma is **pre-1.0 and under active development**. We support the latest commit on `main`. There is no LTS branch, no backport policy, and no promise of API stability between commits before 1.0.

Once a 1.0 ships, this section will be updated with a real supported-versions table.

## Safe harbor

We support good-faith security research. If you:

- Make a good-faith effort to avoid privacy violations, data destruction, and service disruption.
- Only test against your own self-hosted instance, or a public test instance we've designated.
- Give us reasonable time to respond before any public disclosure.

…then we will not pursue legal action against you for your research, and we'll work with you in good faith on disclosure.

## A note on agents

Iarsma's threat model includes the agent itself. If you find a way for an agent to:

- Exceed its granted scopes,
- Commit an action without it appearing in the log,
- Trick a human into approving a dry-run preview that doesn't match what gets committed,
- Or extract the user's credentials through any tool surface,

…that is a security issue, not a bug. Please report it via the channel above.
