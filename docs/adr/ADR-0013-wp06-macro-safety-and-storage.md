# ADR-0013: WP-06 macro safety and storage

**Status:** Accepted for implementation

**Date:** 2026-10-25

## Context

WP-06 requires persistent structured macros, replay controls, bounded waits,
cancellation and explicit multi-target execution. Macro data must not become a
credential store, and the app must not interpret user-authored shell scripts.
The initial SQLite schema already contains `macro_definitions` and
`macro_bindings`; the latter must not silently bind a macro to a live host.

## Decisions

1. Split WP-06 into three independently reviewable slices: WP-06A persists and
   edits typed definitions; WP-06B adds explicit single-terminal recording and
   playback; WP-06C adds confirmed MultiExec fanout. The full WP-06 gate stays
   open until B and C pass their Windows acceptance checks.
2. A definition contains ordered `send`, literal `waitForText`, bounded `delay`
   and explicit `confirm` steps. It has a versioned, exact schema. Definitions
   are not capped by count; each definition has bounded size and step count.
3. Macro targets are selected at each run. No target host, session ID,
   credential, private key or live-shell state is persisted with a macro. The
   existing `macro_bindings` table is unused in WP-06A.
4. Recording is an explicit user action for one already connected terminal.
   App credential dialogs are outside the terminal input stream and are never
   recorded. The UI offers a pause control and suppresses recognized password,
   passphrase, token and secret prompts. Recorded input is stored only after a
   complete line is submitted; terminal output/transcripts are never stored.
5. Playback starts only from an explicit user action, previews the target and
   steps, sends single-line input through the existing typed terminal command,
   and stops on cancellation, disconnect, timeout or failed confirmation. It
   never reconnects or resumes by itself. Wait steps use literal substring
   matching, not regular expressions, to avoid pattern-based denial of service.
6. MultiExec requires explicit target selection and a final preview/confirm.
   Each target result is isolated; a failure or disconnect on one target does
   not silently retry or redirect input to another target.
7. Macro persistence uses the existing SQLite table inside the storage utility
   worker. Renderer access remains through exact, typed commands in preload.
   The app never invokes a shell to interpret macro definitions; the connected
   terminal's shell receives a line only after the user confirms playback.
8. WP-06B1 records only complete lines from one explicitly selected terminal
   into bounded in-memory state, respecting the 64-step cap, per-line cap and
   total macro-text limit after reserving characters for the macro name.
   Clipboard paste is omitted. Terminal output is inspected transiently after
   stripping CSI, OSC, DCS, SOS, PM and APC controls in 7-bit and C1 forms, and
   is never stored. While recording is paused, only a bounded transient prompt
   line is tracked to detect whether a recognized secret prompt remains open;
   resuming in that state keeps recording paused and input suppressed through
   submission. For recognizable full-screen redraws, only the current active
   line is checked so prior visible rows are not processed as new prompts.
   After input is suppressed for a detected prompt and the line is submitted,
   recording pauses and requires an explicit user resume. Detection is
   heuristic and arbitrary secret prompts may go unrecognized.

## Consequences

WP-06A does not claim playback, recording, secret suppression or MultiExec.
WP-06B1 implements explicit recording and heuristic secret-prompt suppression;
playback and MultiExec remain planned until their separate implementations and
Windows evidence are available. `send` steps are user-authored terminal
input and must be reviewed in the playback preview. Because these fields are
user-authored text, static secret detection is not promised; the WP-06A editor
warns users not to enter passwords, tokens or private-key content. No macro
command is logged by the app.

## Verification

WP-06A covers exact schema validation, persistence, update/delete behavior,
100 definitions and restart persistence on Windows. WP-06B1 covers complete
line recording, recognized password and verification-code prompts, explicit
resume, pause-without-partial-line behavior, ANSI control-string stripping,
total text limits and paste omission on Windows. WP-06B2 must exercise exact
preview, literal waits, progress, cancellation, disconnect and no automatic
reconnect. WP-06C must
deliver input to three independent active terminals only after confirmation
and preserve per-target outcomes.
