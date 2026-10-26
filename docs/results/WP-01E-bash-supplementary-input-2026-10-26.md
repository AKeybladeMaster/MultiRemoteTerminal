# WP-01E follow-up: supplementary Unicode input in Git Bash

**Requirements:** F-002; partial progress toward P-02.
**Platform:** Windows 11 x64, Git for Windows 2.53.0.windows.2, Node 24.14.1, Electron 45.0.0.
**Status:** Interactive Git Bash command paste and packaged shell lifecycle are verified on the tested Windows 11 host. Windows 10 acceptance remains open.

## Reproduction

The original command-mode reproduction copied a Bash `printf` command with argument `🙂`, verified the clipboard text before trusted Ctrl+V, and observed U+FFFD in the executed output. A shell-generated emoji rendered correctly. A new focused Windows E2E now verifies the complete trusted-paste, interactive Bash line-edit, command execution and output round trip. The regular Bash acceptance E2E covers BMP Unicode, shell commands, resize, saved-profile reopen and Ctrl+W closure.

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
- A minimized interactive `cat` probe pasted `MRT-RAW:` plus U+1F642 and pressed Enter. The terminal showed the marker twice with U+FFFD in both copies: once from console echo and once from `cat`. Since `cat` reads standard input outside Bash Readline, this locates the corruption before Bash line editing. It still does not distinguish the ConPTY/Windows console input path from Git Bash/MSYS input translation.
- A temporary native `CreatePseudoConsole` harness wrote UTF-8 input to Git Bash through ConPTY pipes and captured the output independently of Electron, `node-pty`, clipboard handling and xterm. Both `C:\Program Files\Git\bin\bash.exe --login -i` and `C:\Program Files\Git\usr\bin\bash.exe --login -i` replaced the U+1F642 input with U+FFFD in the console echo and `cat` output. The wrapper path is therefore not required to reproduce the symptom, but this does not determine whether Windows/ConPTY input processing or Git Bash/MSYS translation is responsible.
- A standalone Node `node-pty` reproduction was attempted, but its Windows console-list helper failed with `AttachConsole failed` outside the Electron utility-process environment. That run is discarded and is not treated as evidence.

The initial supported app path failed for supplementary input before Bash Readline on this host. The independent native ConPTY harness showed that the symptom did not require app-specific terminal components. At that stage, the PowerShell control and non-interactive Bash command passed, while available evidence did not distinguish Git Bash/MSYS input translation from Windows/ConPTY console input processing. The initial probes did not justify an input rewrite or alternate PTY backend; the later protocol-specific probe below provided a bounded adapter-level fix.

## Win32 Input Mode follow-up

The local PTY worker now tracks ConPTY's `CSI ? 9001 h` enable request and matching disable sequence per session, including a sequence split across output chunks. For an authorized local clipboard paste while mode 9001 is enabled, it translates only supplementary UTF-16 pairs into two compact Win32 key-down records and leaves all other text unchanged. Keyboard writes and remote transports are unchanged; clipboard reading, confirmation and authorization remain in the main process. The exact decision is recorded in [ADR-0030](../adr/ADR-0030-conpty-supplementary-clipboard-input.md).

The revised interactive Bash E2E confirms `printf 'MRT-OUTPUT:%s\\n' '🙂'` receives the pasted command and prints `MRT-OUTPUT:🙂`. It passed three consecutive Windows runs. The PowerShell local-terminal E2E with its supplementary-character paste control also passed after the worker change. The separate raw `cat` probe receives and prints the correct character, but ConPTY's console echo still displays U+FFFD and a replacement glyph before `cat` prints it; this is distinct from the passing Bash line-editing round trip.

## Validation

- `corepack pnpm build` and `corepack pnpm typecheck` — passed on Windows x64. Vite emitted the existing renderer chunk-size advisory.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "Git Bash supplementary Unicode paste survives a full command round trip" --repeat-each=3 --workers=1 --reporter=list` — 3 passed on Windows 11 x64 with Git for Windows 2.53.0.windows.2.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "Git Bash supplementary Unicode paste survives a full command round trip|Git Bash runs in a local terminal and saved Bash sessions reopen|Windows local terminal workbench operates real shells, handles 10 tabs and closes their processes" --workers=1 --reporter=list` — 3 passed against the latest build, covering interactive supplementary paste, saved Bash reopen, PowerShell supplementary paste, and the 10-tab lifecycle.
- `corepack pnpm package:win:smoke` — rebuilt unsigned x64 NSIS and portable artifacts; all 4 package E2Es passed, including Git Bash command execution in both installed and portable applications.
- `node --test tests/unit/local-terminal.test.ts tests/unit/broker.test.ts tests/unit/terminal-worker-protocol.test.ts tests/unit/win32-input-mode.test.ts` — 45 passed, including main-only clipboard routing, worker bounds, mode detection across chunks, and UTF-16 record encoding.
- `corepack pnpm lint` — passed, including static, dynamic, export and type import boundary checks.
- `git diff --check` — passed.

F-002 remains partial pending Windows 10 acceptance; the raw ConPTY echo artifact is also documented. P-02 remains partial pending real user-managed WSL distribution interoperability and broader Unix-tool coverage.
