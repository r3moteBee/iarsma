# Iarsma — Agent Collaboration Guide

Reference for agent authors integrating with Iarsma. The [project brief](project-brief.md) "Agent/Human Collaboration Model" section is the authoritative design; this document is the operator/integrator-facing how-to.

## Status

Phase 0 scaffold. Sections grow in:

- **Phase 0:** discovery via `urn:iarsma:agent-context`, OAuth 2.1 + PKCE for agent identities, capability scope vocabulary (see [`capability-scopes.md`](capability-scopes.md)).
- **Phase 2:** registering an agent identity, the read-tool surface, the first agent flow (list mail, read a thread).
- **Phase 3:** the propose-preview-approve-commit pattern, dry-run conventions, approval queue UX, per-agent token revocation, action log query patterns.
- **Phase 4–5:** memory backend integration, OB1 discovery and direct connection, annotation/profile tool patterns.

For now, the brief covers the design.
