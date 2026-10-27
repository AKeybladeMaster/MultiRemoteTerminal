# WP-01N: Bounded PowerShell open-delimiter continuation coloring

**Date:** 2026-10-28
**Requirement:** P-30 (partial)

## Delivered

- Extended the pure PowerShell tokenizer's transient continuation state with an optional stack containing only expected closing characters `)`, `]` and `}`. The stack is copied, frozen in returned state and capped at 32 entries; it stores no delimiter positions or command text.
- The tokenizer carries state across unescaped delimiters only. It ignores delimiters inside strings and comments, and fails closed for mismatched/unmatched delimiters, overflow, invalid incoming stacks, incomplete quotes/here-strings and incomplete block comments. Existing natural operators and caret-at-end checks remain in place.
- The renderer continues to carry state only for the same terminal to the exact `>>` prompt at an unambiguous input end. Existing opt-in, xterm buffer/row/decoration bounds, cleanup and no-text-retention behavior remain unchanged.
- Unit coverage checks parenthesis, bracket and brace matching, nested multirow continuation, command and parameter colors, escaped and opaque delimiter text, invalid state, incomplete strings/comments and the 32-level limit. Windows E2E enters `$values = @(`, checks command/parameter colors across two `>>` rows, closes the subexpression and verifies primary-prompt and decoration cleanup.
- Leading-pipe paste, quoted and here-string continuation, incomplete block comments, other PowerShell natural forms, custom prompt variants and full PowerShell grammar remain unsupported. P-30 remains PARTIAL.

## Validation

- `node --test tests/unit/text-syntax.test.ts tests/unit/terminal-highlights.test.ts` — **55/55 passed**.
- `corepack pnpm lint` — passed, including static import-boundary checks.
- `corepack pnpm exec tsc -b --force` followed by `corepack pnpm typecheck` — passed. An initial typecheck caught a duplicate local variable in the new E2E; it was renamed before the successful run.
- `corepack pnpm build` — passed on Windows x64. Existing Vite chunk advisory: 1,005.32 kB minified / 275.91 kB gzip.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "PowerShell prompt coloring reuses bounded profile tokens" --workers=1` — **1/1 passed**. It exercised the natural `@(` continuation, command/parameter colors and state cleanup.
- `git diff --check` — passed for the implementation, test and documentation changes.

## References

- [ADR-0049](../adr/ADR-0049-powershell-open-delimiter-continuation-coloring.md)
- Microsoft Learn: [`about_Parsing` line continuation](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_parsing)
- [PowerShell 101: One-liners and the pipeline](https://learn.microsoft.com/en-us/powershell/scripting/learn/ps101/04-pipelines)
