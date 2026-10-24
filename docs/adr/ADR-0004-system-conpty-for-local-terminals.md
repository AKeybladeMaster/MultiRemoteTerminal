# ADR-0004 — Use system ConPTY for local terminals

**Status:** Accepted for WP-01 (2026-10-23)

## Context

WP-01 uses the pinned `node-pty` 1.1.0 adapter inside the terminal utility worker. The adapter can select either the Windows-provided ConPTY or the optional ConPTY DLL shipped with the package. During Windows 11 x64 acceptance, resizing the window with nine live PowerShell sessions produced a 79-column xterm resize request and a successful IPC reply, while PowerShell continued to report its original 113-column window after ten seconds when the bundled DLL path was selected. The same focused E2E passed three consecutive runs with the Windows-provided ConPTY path. The full four-test Windows E2E suite then passed, including the ten-tab terminal workflow.

This is evidence from one Windows 11 workstation, not a compatibility result for every supported Windows release. `node-pty` documents the bundled-DLL selection as experimental and defaults it off in the pinned API.

## Decision

Use `node-pty` with `useConpty: true` and `useConptyDll: false`. Keep PTY creation, resize and cleanup inside the utility worker. Keep a Windows E2E that checks the live PowerShell window dimensions after resizing while multiple terminals are open.

## Consequences

- The runtime relies on Windows-provided ConPTY; Windows 10 1809+ remains the documented compatibility target, but still needs a Windows 10 runtime test.
- `node-pty` still stages its optional support DLL during installation; final package contents and size remain a WP-07 packaging check.
- The observed failure was specific to the bundled-DLL selection in the tested workload. Do not generalize it to all node-pty uses or all Windows versions without further evidence.
