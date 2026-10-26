# WP-01E follow-up: supplementary Unicode input in Git Bash

**Requirements:** F-002; partial progress toward P-02.
**Platform:** Windows 11 x64, Git for Windows 2.53.0.windows.2, Node 24.14.1, Electron 45.0.0.
**Status:** Reproduced and tracked as an expected-failure Windows E2E. No production workaround was safe to adopt.

## Reproduction

The original command-mode reproduction copied a Bash printf command with format fragment `MRT-OUT%s` and argument `PUT:🙂`, verified the clipboard text before trusted Ctrl+V, and observed U+FFFD in the executed output. The current expected-failure test first runs `cat`, pastes `MRT-RAW:🙂`, and checks the raw input path. It marks the run expected-to-fail when that path displays `MRT-RAW:�` (U+FFFD); otherwise it continues to the original printf round trip, which must also preserve the character. A shell-generated emoji still renders correctly. The regular Bash acceptance E2E passes for BMP Unicode, shell commands, resize, saved-profile reopen, and Ctrl+W closure.

## Diagnosis

The exact clipboard value is unchanged before the broker writes to the session. A direct call through the typed `writeTerminal` bridge also reproduced the replacement, placing the failure after clipboard retrieval. The executed command output confirms this is input corruption rather than terminal rendering alone.

| Probe | Result |
|---|---|
| `MSYS=disable_pcon` | Same replacement. |
| `MSYS=enable_pcon` | Same replacement when explicitly forcing ConPTY support for the MSYS runtime. |
| `LANG=C.UTF-8` | Same replacement with a scoped UTF-8 locale environment passed to the E2E-launched app and worker. |
| `LC_ALL=C.UTF-8` | Same replacement with the locale override set for the E2E-launched app and worker. |
| `node-pty` string write vs `Buffer.from(text, 'utf8')` | Same replacement. |
| Readline bracketed paste enabled with `bind`, then paste markers sent | Same replacement. |
| Bash `--noediting` | Same input replacement and degraded interactive behavior; rejected. |
| WinPTY for Bash | Shell-generated emoji output was also replaced; rejected. System ConPTY remains required by [ADR-0004](../adr/ADR-0004-system-conpty-for-local-terminals.md). |

Microsoft documents ConPTY input and output streams as UTF-8 ([Pseudoconsoles](https://learn.microsoft.com/en-us/windows/console/pseudoconsoles), [CreatePseudoConsole](https://learn.microsoft.com/en-us/windows/console/createpseudoconsole)). The [MSYS2 terminal guidance](https://www.msys2.org/wiki/Terminals/) warns that interactive line editing when mixing MSYS2 and Windows console paths can be unreliable. This evidence points to the Git Bash/MSYS input-translation path in the tested setup, but does not identify a confirmed upstream defect or universal Git Bash behavior.

## Follow-up controls on 2026-10-26

The host is Windows 11 Pro 10.0.26200.0 with Git for Windows 2.53.0.windows.2, Bash 5.2.37, Node 24.14.1 and Electron 45.0.0.

- The Windows local-terminal E2E pasted U+1F642 through the normal clipboard path into PowerShell and verified `MRT-UNICODE:4:<character>`. This exercises the app's clipboard broker, typed IPC, system ConPTY and xterm display with the same supplementary character.
- A direct noninteractive Git Bash `-c` invocation preserved U+1F642. This shows that the tested Bash executable can accept and emit the character outside the interactive ConPTY input path; it does not isolate which interactive layer replaces it.
- The existing typed `writeTerminal` bridge probe also reproduced U+FFFD, so clipboard retrieval and xterm's native paste handling alone do not explain the failure.
- A minimized interactive `cat` probe pasted `MRT-RAW:` plus U+1F642 and pressed Enter. The terminal showed the marker twice with U+FFFD in both copies: once from console echo and once from `cat`. Since `cat` reads raw standard input without Bash Readline, this locates the corruption before Bash line editing. It still does not distinguish the ConPTY/Windows console input path from Git Bash/MSYS input translation.
- A standalone Node `node-pty` reproduction was attempted, but its Windows console-list helper failed with `AttachConsole failed` outside the Electron utility-process environment. That run is discarded and is not treated as evidence.

The supported app path fails for supplementary input in interactive Git Bash before Bash Readline on this host. The PowerShell control and noninteractive Bash command pass; available evidence does not distinguish Git Bash/MSYS input translation from the Windows/ConPTY console input path. No input rewrite or alternate PTY backend has been shown safe, so F-002 remains incomplete.

## Validation

- `corepack pnpm build` — passed on Windows x64; Vite emitted the existing renderer chunk-size advisory.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "Git Bash" --workers=1 --reporter=list` — 2 passed, including the expected-failure raw-input regression and the normal Bash acceptance flow.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "Windows local terminal workbench|Git Bash supplementary Unicode paste" --workers=1 --reporter=list` — 2 passed: the PowerShell control passed, and the Bash E2E passed as an expected failure after observing U+FFFD in the raw `cat` input path before Bash line editing. The older command-output repro also reproduced in 3/3 runs with `--repeat-each=3` earlier in this investigation.
- `corepack pnpm typecheck`, `corepack pnpm lint` and `git diff --check` — passed on Windows x64.

F-002 remains incomplete until supplementary input works through the supported Git Bash path and packaged shell lifecycle acceptance passes. P-02 remains partial pending real user-managed WSL distribution interoperability and broader Unix-tool coverage.
