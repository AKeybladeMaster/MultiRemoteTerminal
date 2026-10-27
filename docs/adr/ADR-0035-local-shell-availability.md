# ADR-0035: Local shell availability policy

**Status:** Accepted
**Date:** 2026-10-27
**Requirements:** P-21, P-37, F-009

## Context

WP-11A's `visibleLocalShells` preference controls command-palette presentation only. A hidden action could still be invoked by a saved-profile button or a direct typed IPC request. WP-11C already applies a separate availability policy to optional non-shell providers. Local shells need the same explicit start policy while preserving the user's saved definitions and any running processes.

## Decision

- Keep `visibleLocalShells` as a command-palette presentation preference. Add `enabledLocalShells` for the fixed PowerShell, cmd, Git Bash, and WSL registry; do not accept executable paths or third-party code.
- Persist the enabled shell IDs in workbench-preferences schema v11. Schema v10 and earlier migrate with all registered shells enabled to preserve existing behavior. Reject unknown and duplicate IDs; permit an empty list.
- Hide new-shell palette actions unless preferences were read successfully and both the visibility and availability preferences include that shell. Keep the saved definition in the catalog, show that it is disabled, and prevent its reopen until the user re-enables the shell.
- Have the main broker re-read settings before `terminal.open` and WSL distribution discovery. Return the settings error or `NOT_SUPPORTED` when unavailable; do not start a process or discover distributions when disabled. Keep WSL discovery cancellation available for cleanup.
- Leave writes, resize, acknowledgement, and close for already-running sessions available so users can finish work and release resources. Disabling a shell does not terminate or mutate a process that is already running.
- Open the default startup PowerShell terminal only after a successful settings read and only when PowerShell is enabled. If disabled, do not silently substitute another shell.

## Consequences

Users can disable new starts and saved-profile reopening per shell without losing saved definitions or interrupting active sessions. Availability and palette visibility remain independently configurable: hiding an enabled shell removes only its palette action, while disabling a shell blocks starts regardless of visibility. The setting does not install, update, or remove a shell provider, and P-21/P-37/F-009 remain partial until the broader tool lifecycle and logo-picker requirements are covered.

## Validation

WP-11D covers v10-to-v11 migration, list validation, broker denial and fail-closed behavior, active-session I/O/close, settings persistence, startup suppression, and saved-profile re-enable through Windows acceptance tests. See [WP-11D results](../results/WP-11D-local-shell-availability-2026-10-27.md).
