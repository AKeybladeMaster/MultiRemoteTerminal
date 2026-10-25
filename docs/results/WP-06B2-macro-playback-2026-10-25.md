# WP-06B2 Windows evidence: explicit macro playback

**Date:** 2026-10-25

**Branch:** `dev-1`

**Requirements:** F-007 (partial), P-28 (partial), P-40 (partial). Playback of
100 stored definitions and WP-06C MultiExec remain open.

## Delivered

- Added a framework-free application runner for one validated macro and one
  explicitly selected, running local, SSH or Telnet terminal. It sends
  authored single-line input through the existing typed terminal commands and
  allows only one active run.
- Added case-sensitive literal output waits with bounded timeouts and a
  64 KiB transient decoded-text window, bounded delays, inline explicit
  confirmation steps, progress, cancellation and stop-on-disconnect behavior.
  The output reader removes ANSI/control strings as data arrives and clears
  transient text when playback ends. It does not persist a transcript.
- Added a review screen that shows the exact macro steps and a target label
  containing the session name plus shell/protocol and endpoint where
  applicable. The user must press **Run macro**. Manual input to that target
  is disabled until playback ends; write cancellation waits for an in-flight
  terminal write to settle.
- No credential or target data was added to saved macro definitions, and
  playback never reconnects, resumes or runs automatically.
- The actual Windows review screen and the design target are recorded at the
  same 1564x1006 dimensions: [review target](../evidence/WP-06B2-playback-review-target.png)
  and [Windows implementation](../evidence/WP-06B2-playback-actual.png).

## Windows validation

Windows x64 with Node 24.14.1 and Electron 45.0.0:

- Seven focused unit tests cover ordered writes, split literal text with ANSI
  controls, timeout and case sensitivity, cancellation during wait and
  confirmation, disconnect, confirmation decline, invalid/unavailable/busy
  runs and later-step suppression.
- The Windows Electron E2E reviews exact steps and target, runs a successful
  send/wait/delay/confirm/send sequence, cancels a waiting run, then exits the
  target and verifies later steps do not run.
- `corepack pnpm check` passed: TypeScript typecheck, ESLint and import
  boundaries, the complete unit suite, native x64 addon and renderer build,
  and all 21 Windows Electron E2E scenarios.
- Vite still reports its existing renderer chunk-size advisory (>500 kB after
  minification). No dependency was added for this slice.

## Security and remaining limits

The wait matcher sees terminal output after ANSI/control-string stripping but
does not persist it. Macro text remains user-authored local database content;
the editor warns against passwords, tokens and private-key content, but manual
secret detection is not promised. The recorder's secret-prompt detection also
remains heuristic. The Windows playback E2E uses the local PowerShell target;
SSH/Telnet playback interoperability and Windows replay acceptance for 100
definitions remain open. MultiExec is a separate, unimplemented WP-06C slice.

See [ADR-0013](../adr/ADR-0013-wp06-macro-safety-and-storage.md) for macro
safety decisions and [WP-06B1 evidence](WP-06B1-macro-recording-2026-10-25.md)
for recording behavior.
