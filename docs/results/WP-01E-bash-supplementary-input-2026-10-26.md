# WP-01E follow-up: supplementary Unicode input in Git Bash

**Requirements:** F-002; partial progress toward P-02.
**Platform:** Windows 11 x64, Git for Windows 2.53.0.windows.2, Node 24.14.1, Electron 45.0.0.
**Status:** Reproduced and tracked as an expected-failure Windows E2E. No production workaround was safe to adopt.

## Reproduction

The Windows E2E copies a Bash printf command with format fragment `MRT-OUT%s` and argument `PUT:🙂` to the clipboard, then verifies the exact clipboard text before trusted Ctrl+V. Those pieces produce `MRT-OUTPUT:🙂`, a marker absent from the echoed command. The test waits for this output, marks the run as expected-to-fail only if it observes `MRT-OUTPUT:�` (U+FFFD), and then asserts the intended `MRT-OUTPUT:🙂`. A shell-generated emoji still renders correctly. The regular Bash acceptance E2E continues to pass for BMP Unicode, shell commands, resize, saved-profile reopen, and Ctrl+W closure.

The expected-failure annotation is conditional on observing U+FFFD in the executed output. If the full Unicode character reaches Bash, the regression test passes without the expected-failure annotation.

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

## Validation

- `corepack pnpm build` — passed on Windows x64; Vite emitted the existing renderer chunk-size advisory.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "Git Bash"` — 2 passed, including the expected-failure compatibility regression and the normal Bash acceptance flow.

F-002 remains incomplete until supplementary input works through the supported Git Bash path and packaged shell lifecycle acceptance passes. P-02 remains partial pending real user-managed WSL distribution interoperability and broader Unix-tool coverage.
