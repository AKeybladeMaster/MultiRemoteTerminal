# WP-01J: Shell backslash continuation coloring — acceptance evidence

**Date:** 2026-10-27

**Platform:** Windows x64, Node.js 24.14.1, Electron 45.0.0

**Requirements:** P-30 and F-014 (partial)

## Delivered behavior

- The bounded pure Shell tokenizer returns only lexical flags when active input ends with an unquoted odd backslash. It carries command-position, fixed wrapper, pending wrapper option/assignment and `[[ ... ]]` context across the next recognized prompt.
- A `TerminalPane` consumes those flags only when the following visible normal-buffer prompt ends in `>`. The per-terminal state contains no submitted command text and is cleared on completion, cancellation, failed input/paste, read-only/disconnected state, disabling syntax coloring, a mismatching prompt or pane teardown.
- Inline backslash-newline scanning preserves the existing token positions. Even trailing backslash runs and truncated preview boundaries do not produce continuation state. Existing input-size, row and decoration bounds remain in force; serial remains excluded.
- Windows Git Bash E2E verifies `env \` reaches PS2, `git` and `--version` receive their prompt colors, and the completed command produces Git version output. The test refocuses xterm after the preceding Ctrl+C cleanup and asserts the literal typed continuation line before submitting it.

Quoted backslash continuations, open quotes, substitutions, compound-block continuation and custom secondary prompt formats remain unsupported. This is a lexical aid, not a Shell parser; P-30 and F-014 remain PARTIAL. No dependency was added. See [ADR-0045](../adr/ADR-0045-shell-backslash-continuation-coloring.md).

## Diagnosis captured during acceptance

The first unit run caught an even-run bug: after scanning a pair of backslashes as ordinary input, the tokenizer reconsidered the second character as a one-backslash suffix and incorrectly returned continuation state. The scanner now recognizes a run only at its first character; the even/odd regression cases pass.

The first Git Bash E2E attempt did not display the continuation line after Ctrl+C cleanup because xterm no longer had keyboard focus. Refocusing the terminal and asserting the typed line made the PS2 interaction deterministic; the final Windows E2E passed.

## Validation

- `corepack pnpm exec tsc -b --force` — passed.
- `corepack pnpm typecheck` — passed after the forced project-reference rebuild.
- `corepack pnpm build` — passed. Vite reported the existing large renderer-chunk advisory (1,001.50 kB minified / 274.84 kB gzip).
- `corepack pnpm lint` — passed, including static import-boundary checks.
- `node --test tests/unit/text-syntax.test.ts tests/unit/terminal-highlights.test.ts` — 45/45 passed.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "Git Bash runs in a local terminal and saved Bash sessions reopen" --reporter=line` — 1/1 Windows Electron E2E passed.
- `git diff --check` — passed.

Independent review is recorded in [WP-01J review outcome](WP-01J-review.md).
