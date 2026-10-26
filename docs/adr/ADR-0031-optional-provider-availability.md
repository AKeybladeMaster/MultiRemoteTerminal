# ADR-0031: Fixed optional provider availability

**Status:** Accepted
**Date:** 2026-10-26
**Requirements:** P-31, P-37, F-017; supporting controls for P-04, P-07, P-08, P-10, P-12, and P-20

## Context

The workbench has several built-in optional connections and local services, but users could not disable their new launch paths across the application. Hiding one command-palette item would not protect direct quick-connect buttons, saved-profile reopen, or a crafted renderer IPC request. P-31/F-017 call for user-controlled provider availability without allowing arbitrary plugin code.

## Decision

- Define one fixed domain registry for Telnet, FTP/FTPS, serial, external RDP and VNC viewers, and the local TFTP server. The registry contains no executable paths or user-provided code.
- Persist the enabled IDs as `enabledOptionalConnections` in workbench-preferences schema v10. Schema v9 and older records migrate with all currently supported providers enabled, preserving existing behavior. Unknown and duplicate IDs are invalid; an empty list is valid.
- Render optional launch actions only after a successful preference read and only when that provider is enabled. Settings are the only user-facing control for this allowlist.
- Before a new provider entry point, the main-process broker reads the persisted preferences and rejects the request if that provider is disabled. If settings cannot be read or validated, the broker returns the storage error and does not start the provider.
- Apply the gate to new Telnet/FTP sessions, serial port listing/open, RDP/VNC viewer launches, and TFTP root selection/start. Do not block input, file work, close, or TFTP stop for already-running sessions; users need those operations to finish and clean up existing work.
- Keep SSH/SFTP and local shells outside this optional-connection list. Local-shell command visibility has its existing separate preference. Do not implement arbitrary plugin registration, third-party provider discovery, installation, updates, or removal here.

## Consequences

Users can disable supported optional provider entry points and later re-enable them. Saved definitions are retained while disabled, but reopening one is blocked until its provider is enabled. Existing active work remains available for completion and shutdown. Provider actions default to enabled, so no existing connection type disappears after migration. P-31/F-017 remain partial until approved third-party provider provenance and lifecycle management exist.

## Validation

WP-11C covers allowlist normalization, v9-to-v10 SQLite migration, corruption rejection for a v10 record missing the list, broker enforcement for every provider entry point, fail-closed settings reads, and continued active-session cleanup. Its Windows E2E verifies settings persistence, palette and quick-connect visibility, restart behavior, re-enable, and the Telnet connection dialog. See [WP-11C results](../results/WP-11C-optional-provider-controls-2026-10-26.md).
