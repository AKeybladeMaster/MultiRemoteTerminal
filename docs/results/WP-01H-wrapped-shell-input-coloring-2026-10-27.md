# WP-01H: Wrapped shell input coloring — acceptance evidence

**Date:** 2026-10-27
**Platform:** Windows 11 x64, Node.js 24.14.1, pinned workspace toolchain
**Requirement:** P-30 terminal syntax highlighting (partial)

## Delivered behavior

- The existing opt-in prompt-coloring preference now follows user input across consecutive xterm physical rows marked `isWrapped`. A hard line break or a row outside that wrapped chain does not inherit the prompt anchor.
- The renderer reconstructs the active command from bounded xterm cell spans and maps shared Shell-token ranges back to each physical row. A token that crosses a wrap is decorated on both sides without changing the terminal bytes.
- Each refresh is bounded to 2,048 UTF-16 code units, 128 physical rows and 64 Shell decorations. Additional row markers and all decorations are transient and are released on refresh or pane teardown; Enter, Ctrl+C, Ctrl+D, Ctrl+L, failed paste and preference disable retain WP-01G cleanup behavior.
- Git Bash acceptance verifies prompt coloring for an ordinary unsubmitted Shell command. SSH and Telnet acceptance use an unsubmitted command with 300 filler characters in a narrowed terminal window; they confirm the start and end markers occupy separate rendered rows, verify the opening `if` and `true` tokens plus closing `fi`, then check Ctrl+C cleanup. Git Bash's Readline horizontally scrolls a long input line, so its acceptance does not assert physical xterm wraps.

P-30 remains PARTIAL. Shell grammar is lexical, continuation prompts and explicit newlines are not colored, prompt recognition remains heuristic, and broad server interoperability remains open. See [ADR-0036](../adr/ADR-0036-terminal-wrapped-shell-input-coloring.md).

## Validation

- `corepack pnpm build` passed on Windows 11 x64 with Node.js 24.14.1 and Electron 45.0.0. The native system-directory addon compiled; Vite reported the existing renderer bundle advisory at 968.30 kB minified.
- `node --test tests/unit/terminal-highlights.test.ts` passed 7/7.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "Git Bash runs in a local terminal|shell prompt coloring works in SSH and Telnet|terminal keyword highlighting saves rules" --reporter=line` passed 3/3. Git Bash covers ordinary prompt coloring; loopback SSH/Telnet cover physical wrapped input and Ctrl+C overlay cleanup; keyword E2E covers the unchanged output-highlighting path.
- `corepack pnpm typecheck`, `corepack pnpm lint` (including import-boundary checks) and `git diff --check` passed.
