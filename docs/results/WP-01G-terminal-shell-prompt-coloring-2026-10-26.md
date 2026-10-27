# WP-01G: Terminal shell prompt coloring — acceptance evidence

**Date:** 2026-10-26  
**Platform:** Windows 11 x64, Node.js 24.14.1, pinned workspace toolchain  
**Requirements:** P-30 terminal syntax highlighting (partial)

## Delivered behavior

- Settings add an opt-in `Color shell commands at prompts` preference, off by default. Preference schema v4 migrates valid schemas v1, v2 and v3 while leaving this option disabled.
- After the user types at a visible prompt ending in `$`, `#`, `%`, `>`, `❯` or `➜`, local, SSH and Telnet panes use the shared Shell tokenizer to color tokens on the active xterm input row. Serial panes are excluded.
- Coloring uses the existing theme palette and transient xterm decorations. The feature does not modify terminal input/output bytes, add shell hooks, log commands or persist terminal text. Submission, common cancel/clear keys, failed paste and pane teardown release the transient anchor.
- The visible physical row remains bounded to 2,048 UTF-16 code units; each refresh creates at most 64 Shell token decorations.

This improves readability for common typed shell commands, including Bash, and recognizes two common zsh-style prompt glyphs. It is not a full parser, shell-specific semantic check, wrapped-line renderer or zsh theme. P-30 remains PARTIAL.

## Validation

- `node --test tests/unit/workbench-preferences.test.ts tests/unit/sqlite-workbench-preferences.test.ts tests/unit/terminal-highlights.test.ts` — 21/21 passed, covering prompt endings, anchor marker disposal, schema-v3 migration defaults, opt-in validation and persistence.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "terminal keyword highlighting|Git Bash runs in a local terminal" --reporter=line` — 2/2 Windows Electron E2Es passed. Git Bash input under a custom zsh-style `❯` prompt shows the expected `if` and `true` token colors; Ctrl+C removes the active token decorations; settings persist across restart, while keyword coloring continues to preserve independent ANSI colors.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "shell prompt coloring works in SSH and Telnet" --reporter=line --workers=1` — 1/1 Windows Electron E2E passed. Trusted loopback SSH and explicitly acknowledged loopback Telnet both color `if` and `true` under a `❯` prompt; Ctrl+C removes the active token decorations. The Telnet fixture strips option negotiation and subnegotiation frames before echoing user input.
- Dedicated local Git Bash, SSH and Telnet Windows UI acceptance now exercises the shared prompt-coloring renderer path. The Git Bash case also verifies preference persistence across restart and independent ANSI colors for existing keyword highlights.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including static import-boundary checks.
- `corepack pnpm build` — passed on Windows x64 with Node.js 24.14.1. The renderer bundle is 941.37 kB minified / 257.45 kB gzip and triggers Vite's 500 kB advisory.
- `git diff --check` — passed after implementation and documentation updates.
- The generated `test-results/bash-shell-syntax-prompt.png` was visually inspected; the live command remains visible in xterm and token colors are applied without rewriting its text.

## Independent review

- **Spec:** The initial review found no blocking findings. Its original diff covered dedicated UI acceptance only for local Git Bash; the remote acceptance follow-up below closes that evidence gap. P-30 remains PARTIAL.
- **Standards:** No documented-standard breaches. The marker cleanup evidence gap is resolved by unit and Windows E2E assertions, and xterm cell extraction is shared by both keyword and shell decorators.

Reviewers performed static review of the pinned diff and did not rerun tests; the validation results above were run after the cleanup follow-up.

## Remote acceptance follow-up (2026-10-27)

- Final Windows UI run: `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "terminal keyword highlighting|Git Bash runs in a local terminal|shell prompt coloring works in SSH and Telnet" --reporter=line --workers=1` — 3/3 passed after review fixes. The shared color assertion checks the Shell keyword `if` and command `true`; each Git Bash, SSH and Telnet case sends Ctrl+C and waits for decoration cleanup.
- `corepack pnpm typecheck` and `corepack pnpm lint` passed, including static import-boundary checks. `git diff --check` passed. `corepack pnpm build` passed for the current production source (967.04 kB minified renderer bundle; Vite's 500 kB advisory); later review fixes changed only E2E code.
- **Spec review:** no missing/partial acceptance behavior, scope creep or incorrect implementation found.
- **Standards review:** the initial review found cleanup could stop if Electron close rejected and duplicated token-color assertions. The follow-up uses nested `finally` blocks, attempts each Telnet socket and SSH client independently, then closes both listeners and removes the profile. Git Bash, SSH and Telnet now share the color and Ctrl+C cleanup helpers. Final review found no remaining documented-standard breach or smell.
- Reviews were static and did not rerun tests; the 3/3 Windows result above was run after the final cleanup changes.

## Limits and follow-up

Prompt endings are heuristic and do not identify a shell. Wrapped command lines and shell continuation prompts are not colored. Shell token colors are lexical hints and do not validate command syntax or safety. The current xterm screen buffer is renderer state; no terminal transcript is written by this feature.

WP-01H later extends the bounded renderer to consecutive wrapped input rows; see [WP-01H evidence](WP-01H-wrapped-shell-input-coloring-2026-10-27.md). Shell continuation prompts and full shell grammar remain unsupported.

See [ADR-0024](../adr/ADR-0024-terminal-shell-prompt-coloring.md), [WP-01F terminal keyword coloring](WP-01F-terminal-highlights-2026-10-25.md) and [WP-08E editor syntax profiles](WP-08E-text-syntax-profiles-2026-10-26.md).
