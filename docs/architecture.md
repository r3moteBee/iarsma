# Iarsma — Architecture

This document is the living architecture reference. The [project brief](project-brief.md) is the authoritative high-level architecture; this document expands selected areas with diagrams, sequence flows, and component-level detail as they get built.

## Status

Phase 0 scaffold. As the project moves through phases, this doc grows the following sections:

- **Phase 0:** auth flow sequence diagram (browser → token-exchange sidecar → Stalwart OIDC), capability contract codegen pipeline diagram, action log component internals.
- **Phase 1:** JMAP state-token reconciliation, sanitizer threat model, virtualized-list focus management.
- **Phase 2:** Squire + ammonia integration sequence, attachment upload flow, MCP read-tool surface diagram.
- **Phase 3:** propose-preview-approve-commit sequence (UI + agent paths), policy seam interface, push subscription resilience.
- **Phase 4–5:** memory backend trait + OB1 integration, file backend + Git semantics.
- **Phase 6:** Tauri 2 platform abstraction layer, native push bridges.

For now, refer to the brief's "Architecture" and "Agent/Human Collaboration Model" sections.
