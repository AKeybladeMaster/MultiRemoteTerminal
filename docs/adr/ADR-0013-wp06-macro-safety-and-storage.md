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
   is never stored. At recording start, the selected terminal's current xterm
   cursor line is inspected transiently for a prompt already in progress.
   While paused, only a bounded transient prompt line is tracked; recognized
   secret-prompt state remains latched until Enter or Ctrl+C so echoed text or
   a line break cannot clear suppression. Resume while the prompt remains
   open keeps recording paused and input suppressed. For recognizable
   full-screen redraws, a bounded row map follows common CSI cursor movement
   and erase controls and checks only the cursor row. After input is suppressed
   for a detected prompt and the line is submitted, recording pauses and
   requires an explicit user resume. Prompt and redraw detection are heuristic;
   arbitrary secrets and unsupported redraw styles may go unrecognized.

## Consequences

WP-06A does not claim playback, recording, secret suppression or MultiExec.
WP-06B1 implements explicit recording and heuristic secret-prompt suppression.
WP-06B2 implements explicit single-terminal playback: the renderer previews
the saved steps and a running local, SSH or Telnet target, and only the Run
action starts the application runner. The runner sends a single line through
existing typed terminal commands, matches literal output in a bounded
transient window, applies bounded waits and delays, and pauses for each
authored confirmation. Cancellation or a failed wait/write/disconnect stops
the sequence and later steps are not sent. The target terminal rejects
manual input while playback is active. No target is stored in the macro, and
there is no reconnect or automatic resume. `send` steps remain user-authored
terminal input; the editor warns against passwords, tokens and private-key
content, while static secret detection is not promised. No macro command or
terminal transcript is logged by the app.

## Verification

WP-06A covers exact schema validation, persistence, update/delete behavior,
100 definitions and restart persistence on Windows. WP-06B1 covers complete
line recording, recognized password and verification-code prompts, explicit
resume, pause-without-partial-line behavior, ANSI control-string stripping,
total text limits and paste omission on Windows. WP-06B2 unit and Windows
Electron E2E coverage verifies exact preview, literal waits, progress,
confirmation, cancellation, disconnect and no later sends. Windows replay of
100 definitions and broader adapter interoperability remain open. WP-06C must
deliver input to three independent active terminals only after confirmation
and preserve per-target outcomes.
