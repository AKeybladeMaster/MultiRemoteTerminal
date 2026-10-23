# ADR-0002 — Capability providers, local SQLite and separate vault

**Status:** Accepted as initial design (2026-10-23)

## Context

Remote SSH shell, SFTP, forwarding and third-party desktop/X11 tools are different kinds of runtime. A monolithic switch over protocol types in the renderer would create tight coupling, fragile error handling and unsafe privilege access.

## Decision

Define `ProviderRegistry`, `ConnectionRuntime`, `FileTransferController`, `TunnelController`, `SecretVault` and `SessionCatalog` deep interfaces. Store configuration in local SQLite (migrated, WAL, foreign keys); secrets in an independently protected vault using OS-backed encryption by default and optional independent master-password envelope. Use provider capability metadata and real integration test evidence.

## Consequences

- Feature flags describe actual provider capabilities; unsupported integration is visible and testable.
- RDP/VNC/X11 can start as *external integrated* providers; not mislabeled as embedded.
- Unlimited definitions remain possible while resource-based live-session limits protect the computer.
- Credential references allow config import/export without secret disclosure.
- DB migration and provider contract tests become mandatory.
