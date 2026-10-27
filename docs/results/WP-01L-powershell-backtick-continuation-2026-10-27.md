# WP-01L PowerShell backtick continuation coloring

**Date:** 2026-10-27

## Requirement coverage

- P-30: adds bounded lexical-state carry across an explicit PowerShell backtick continuation. P-30 remains PARTIAL.

## Delivered

- The shared pure-domain PowerShell tokenizer reports only `commandExpected` and `previousTokenIsBareWord` when complete input ends in an odd backtick run outside a string, here-string or comment.
- The renderer carries that state only for the same terminal and only consumes it at an exact visible `>>` prompt. Existing opt-in setting, 2,048-code-unit/128-row/64-decoration limits, transient xterm markers and cleanup paths remain in use.
- Continuation state is carried only when the caret is at the end of the logical input. The renderer checks for remaining text in the current row and bounded wrapped rows; uncertain or over-bound buffer data fails closed.
- No submitted command text is retained, logged, persisted, validated or executed for highlighting. No dependency or IPC command was added.
- Unit coverage rejects even runs, trailing whitespace, opaque strings/comments and truncated previews. Windows E2E covers PowerShell prompt colors, the explicit continuation, parameter/variable colors at `>>`, and Ctrl+C cleanup.
- Renderer regressions verify that a caret before remaining same-row or wrapped-row text cannot create continuation state, while an end-of-input caret still can.

## Validation

- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "Git Bash runs in a local terminal and saved Bash sessions reopen" --workers=1` - **1/1 passed**, preserving the existing local Bash regression.

- `node --test tests/unit/text-syntax.test.ts tests/unit/terminal-highlights.test.ts` — **52/52 passed**.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including static import-boundary checks.
- `corepack pnpm build` — passed on Windows x64. Vite reports the existing renderer chunk advisory at 1,003.87 kB minified / 275.31 kB gzip.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "PowerShell prompt coloring reuses bounded profile tokens" --workers=1` — **1/1 passed**. The test waits for the full line echo before Enter, then verifies the exact `>>` prompt, continuation token colors and Ctrl+C cleanup.
- `git diff --check` — passed.

## Limits and security

This remains a lexical color hint, not a PowerShell parser. Natural continuation forms, quoted backticks, custom continuation prompt text and full PowerShell grammar remain unsupported. Prompt matching is shape-based, so a custom prompt that is exactly `>>` matches only while state is pending. The renderer samples xterm's parsed normal buffer; no command text is sent separately for highlighting. Microsoft documents that a trailing space after the backtick breaks explicit continuation and identifies natural continuation points in [`about_Parsing`](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_parsing).

See [ADR-0047](../adr/ADR-0047-powershell-backtick-continuation-coloring.md). Independent review outcomes and their resolution are recorded in [WP-01L review](WP-01L-review.md).
