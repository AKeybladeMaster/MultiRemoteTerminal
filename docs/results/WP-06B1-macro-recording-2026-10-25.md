# WP-06B1 Windows evidence: explicit macro recording

**Date:** 2026-10-25

**Branch:** `dev-1`

**Requirements:** F-007 (partial), P-28 (partial), P-40 (partial). Playback,
MultiExec and Windows acceptance of 100 definitions remain open.

## Delivered

- Added an application-layer recorder for one explicitly selected, running
  local, SSH or Telnet terminal. Only complete input lines are retained, with
  the macro schema's 64-step cap and 4,096-character send-line cap.
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

- Six focused recorder unit tests cover completed lines, target isolation,
  backspace, prompt suppression and explicit resume, echoed-command handling,
  focus-report handling, unsafe input, pause behavior and step limits.
- The Windows Electron E2E records a PowerShell command that asks for a
  password, verifies the recognized prompt pauses recording, submits a dummy
  secret, explicitly resumes, then saves two safe command lines. It also pastes
  a command and verifies that pasted text is not recorded.
- The existing macro-library E2E checks keyboard focus during editor creation,
  create/edit, restart persistence and deletion. After the focus adjustment it
  passed five consecutive isolated repetitions.
- The recorder E2E passed five consecutive isolated repetitions after start and
  resume focus was moved to a post-commit effect; the earlier run intermittently
  dropped or truncated the first resumed input character.
- `corepack pnpm check` passed on the final source: TypeScript typecheck, ESLint
  and import-boundary checks, 249 unit tests, native x64 addon and renderer
  build, and all 19 Electron E2E tests. Vite reports its existing renderer
  bundle-size warning (>500 kB after minification).

## Security and remaining limits

Prompt matching is heuristic and does not protect arbitrary secrets or prompt
styles the matcher does not recognize. Users must not treat recording as a
secret detector and must not enter secrets while it is active. User-authored
macro text remains local database content. The E2E covers local PowerShell;
SSH and Telnet recorder flows, playback, cancellation, and the 100-definition
Windows acceptance remain open. No package was added for this slice.

See [ADR-0013](../adr/ADR-0013-wp06-macro-safety-and-storage.md) for the safety
decisions and [WP-06A evidence](WP-06A-macro-library-2026-10-25.md) for macro
catalog coverage.
