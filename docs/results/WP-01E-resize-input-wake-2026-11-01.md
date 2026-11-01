# WP-01E - Git Bash resize input wake

Requirements: P-02/F-002. Scope: Windows 11 x64, installed Git for Windows 2.45.2, Bash 5.2.26, MSYS 3.4.10, Electron 45.0.0/node-pty 1.1.0. Node 24.14.1 and pnpm 12.15.0 were used for this candidate.

## Change and boundary

The worker adapter stores the launch shell. After a Bash resize, only when ConPTY has requested mode 9001, it writes one empty Win32 key-up (zero virtual key/scan code/character/modifiers). The event wakes native input processing without supplying a user character. There is no delay, input replay, Readline change or new IPC. This is a measured workaround for the MSYS/ConPTY boundary; the exact upstream race is not proven. See [ADR-0066](../adr/ADR-0066-git-bash-resize-input-wake.md).

## Diagnostic results

| Candidate | Focused result |
| --- | --- |
| Original production code with raw IPC capture | 8/10 passed; two lost leading p |
| Printable input encoded as Win32 records | 6/10 passed; four lost leading p |
| Direct usr/bin/bash instead of launcher | 1 pass, 1 failure; diagnostic stopped |
| Empty key-down wake after resize | 10/10 passed |
| Empty key-up wake after resize | 10/10 passed |
| Production source, typing/editing/paste | 10/10 passed |
| Final corrected source/test, including native cmd child | 10/10 passed, 0 skipped/failed (1.1m) |

The earlier separate timeout trace stalled clicking New Bash before resizing. The final test establishes the initial PowerShell tab before opening Bash and gives the multi-step scenario a 60-second bound. The actual immediate-after-resize actions have no settle delay. Temporary raw-IPC tracing and generated-worker probes were removed; logs/traces remain ignored under workspace .tmp.

## Final verification

- TypeScript/application/tools typecheck, changed-file ESLint and Windows x64 native/renderer build passed.
- Adapter, preload ordering and Win32 mode tests: 52 passed, 0 skipped/failed.
- Re-enabled focused Electron E2E: 10 passed, 0 skipped/failed. Every repetition checks actual dimensions plus immediate typing, immediate paste, retained command-line input/Backspace and an interactive native cmd child. The editing marker includes an end delimiter so OKX cannot falsely match expected OK output.
- The whole repository suite was not rerun, as requested. The earlier whole-suite result predates this repair and is not final-candidate full-suite evidence.

## Independent review

Standards/Architecture: no Critical/Important findings. Specification: one Important false-positive editing assertion was fixed, re-reviewed and passed the corrected repeat run; no outstanding finding. Security/Correctness: no Critical/Important finding; confirmed the legal empty key-up syntax and bounded shell/mode gates. Reviews cover the current diff against 6205ce71602c8276ed34eae50512d7540d097e46, not line-by-line certification of all historical phase work. The available installed code-review workflow was used; the historical Beasty requesting-code-review path was unavailable.

## Limits

Raw console programs can observe the empty native key-up. Native cmd and normal Bash editing pass; arbitrary native applications and other Windows/Git/MSYS versions remain unverified. P-02/F-002 remain PARTIAL for those broader requirements, real WSL and Windows 10. P-25/N-010 and other phase/release gates remain open. Runnable package results and signature status are recorded in the Phase 08/11 ledgers.

## Compatibility and package follow-up

The three existing Git Bash shell/reopen, BMP clipboard and supplementary-Unicode roundtrip E2Es passed3/3. Final Windows package-and-smoke exited0 with6/6 passed. The packaged PTY worker matches the rebuilt worker byte-for-byte. Runnable paths, SHA-256 values, signature state and remaining release limits are in [binary evidence](WINDOWS-BINARIES-2026-11-01.md).
