# WP-01G: Terminal shell prompt coloring — acceptance evidence

**Date:** 2026-10-26  
**Platform:** Windows 11 x64, Node.js 24.14.1, pinned workspace toolchain  
**Requirements:** P-30 terminal syntax highlighting (partial)

## Delivered behavior

- Settings add an opt-in `Color shell commands at prompts` preference, off by default. Preference schema v4 migrates valid schemas v1, v2 and v3 while leaving this option disabled.
- After the user types at a visible prompt ending in `$`, `#`, `%` or `>`, local, SSH and Telnet panes use the shared Shell tokenizer to color tokens on the active xterm input row. Serial panes are excluded.
- Coloring uses the existing theme palette and transient xterm decorations. The feature does not modify terminal input/output bytes, add shell hooks, log commands or persist terminal text. Submission, common cancel/clear keys, failed paste and pane teardown release the transient anchor.
- The visible physical row remains bounded to 2,048 UTF-16 code units; each refresh creates at most 64 Shell token decorations.

This improves readability for common typed shell commands, including Bash. It is not a full parser, shell-specific semantic check, wrapped-line renderer or zsh theme. P-30 remains PARTIAL.

## Validation

- `node --test tests/unit/workbench-preferences.test.ts tests/unit/sqlite-workbench-preferences.test.ts tests/unit/terminal-highlights.test.ts` — 16/16 passed, covering prompt endings, schema-v3 migration defaults, opt-in validation and persistence.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "terminal keyword highlighting|Git Bash runs in a local terminal" --reporter=line` — 2/2 Windows Electron E2Es passed. Git Bash input shows the expected `if` and `true` token colors; settings persist across restart, while keyword coloring continues to preserve independent ANSI colors.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including static import-boundary checks.
- `corepack pnpm build` — passed on Windows x64 with Node.js 24.14.1. The renderer bundle is 928.21 kB minified / 254.32 kB gzip and triggers Vite's 500 kB advisory.
- `git diff --check` — passed after implementation and documentation updates.
- The generated `test-results/bash-shell-syntax-prompt.png` was visually inspected; the live command remains visible in xterm and token colors are applied without rewriting its text.

Independent Standards and Spec review — pending.

## Limits and follow-up

Prompt endings are heuristic and do not identify a shell. Wrapped command lines and shell continuation prompts are not colored. Shell token colors are lexical hints and do not validate command syntax or safety. The current xterm screen buffer is renderer state; no terminal transcript is written by this feature.

See [ADR-0024](../adr/ADR-0024-terminal-shell-prompt-coloring.md), [WP-01F terminal keyword coloring](WP-01F-terminal-highlights-2026-10-25.md) and [WP-08E editor syntax profiles](WP-08E-text-syntax-profiles-2026-10-26.md).
