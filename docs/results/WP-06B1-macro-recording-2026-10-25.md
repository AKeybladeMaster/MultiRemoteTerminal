# WP-06B1 Windows evidence: explicit macro recording

**Date:** 2026-10-25

**Branch:** `dev-1`

**Requirements:** F-007 (partial), P-28 (partial), P-40 (partial). Playback,
MultiExec and Windows acceptance of 100 definitions remain open.

## Delivered

- Added an application-layer recorder for one explicitly selected, running
  local, SSH or Telnet terminal. Only complete input lines are retained, with
  the macro schema's 64-step cap, 4,096-character send-line cap and total text
  budget after reserving space for the macro name.
- Clipboard paste uses the existing trusted paste command and bypasses
  recording. Terminal output is inspected transiently for prompt matching; no
  output or transcript is persisted.
- The recorder strips ANSI control sequences before matching common password,
  passphrase, token, secret, verification-code and one-time-code prompts. It
  suppresses input through submission and automatically pauses until the user
  explicitly resumes.
- The recorder UI reports the selected target, line count and safety state. It
  supports pause, resume, stop/save, retry after a save error and discard.
  Target and terminal state are not stored in macro definitions.
- Dialog/editor name focus is applied in the same React commit as its state
  change. Starting or resuming a recording activates the selected terminal and
  restores terminal focus after the dialog closes, so immediate typing is not
  lost.

## Windows validation

Windows x64 with Node 24.14.1 and Electron 45.0.0:

- Twelve focused recorder unit tests cover completed lines, target isolation,
  backspace, prompt suppression and explicit resume, echoed-command handling,
  focus-report handling, unsafe input, manual pause/resume, multi-stage secret
  prompts, ANSI control strings, and per-line, step and aggregate text limits.
- The Windows Electron E2E records PowerShell commands that ask for a password
  and a verification code, verifies each recognized prompt pauses recording,
  submits dummy secrets, explicitly resumes, then saves safe command lines. It
  also pastes a command and verifies that pasted text is not recorded.
- The existing macro-library E2E checks keyboard focus during editor creation,
  create/edit, restart persistence and deletion. After the focus adjustment it
  passed ten consecutive isolated repetitions. The editor defers focus until
  after the click event, and terminal-focus callbacks now yield while the macro
  manager is open.
- The recorder E2E passed five consecutive isolated repetitions after start and
  resume focus was moved to a post-commit effect and assertions wait for terminal
  focus before typing. The current E2E also exercises a second secret prompt
  while paused and verifies Resume remains paused until the submitted secret
  is discarded. A redraw regression covers PowerShell repainting old prompt
  text after resume.
- `corepack pnpm check` passed on this follow-up: TypeScript typecheck, ESLint
  and import-boundary checks, 255 unit tests, native x64 addon and renderer
  build, and all 19 Electron E2E tests. Vite reports the renderer bundle-size
  advisory (>500 kB after minification).

## Security and remaining limits

Prompt matching is heuristic and does not protect arbitrary secrets or prompt
styles the matcher does not recognize. While paused, a bounded transient line
is checked only to determine whether a recognized secret prompt remains open;
resuming then keeps recording paused and suppresses input through submission.
Recognizable full-screen redraws scan only the current active line, so older
visible rows are not reprocessed as fresh prompts. Users must not treat
recording as a secret detector and must not enter secrets while it is active.
User-authored macro text remains local database content. The E2E covers local PowerShell;
SSH and Telnet recorder flows, playback, cancellation, and the 100-definition
Windows acceptance remain open. No package was added for this slice.

See [ADR-0013](../adr/ADR-0013-wp06-macro-safety-and-storage.md) for the safety
decisions and [WP-06A evidence](WP-06A-macro-library-2026-10-25.md) for macro
catalog coverage.
