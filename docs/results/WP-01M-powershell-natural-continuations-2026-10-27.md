# WP-01M: Common natural PowerShell continuation coloring

**Date:** 2026-10-27
**Requirement:** P-30 (partial)

## Delivered

- The pure bounded PowerShell tokenizer carries its existing command-position flags after selected trailing pipeline, binary, assignment, logical and array-separator operators. Trailing whitespace after a recognized operator is allowed; an escaped operator, quoted token or trailing comment does not start this continuation state.
- The renderer continues to consume state only for the same terminal at an exact visible `>>` prompt and only when the caret is at an unambiguous logical input end. Existing xterm buffer, row, decoration and cleanup limits apply; no submitted command text is retained, logged, persisted or sent for highlighting.
- Added domain regressions for repeated pipeline continuations, command/parameter coloring state, binary and array-separator operators, logical pipeline-chain operators and right-hand command coloring, escaped/quoted/comment forms and the preview limit. Windows E2E verifies a real `Get-Process |` continuation, command/parameter colors on the `>>` row and Ctrl+C cleanup.
- Open-delimiter tracking, leading-pipe paste, other natural continuation forms, full grammar and broad PowerShell interoperability remain unsupported. P-30 stays PARTIAL.

## Validation

- `node --test tests/unit/text-syntax.test.ts tests/unit/terminal-highlights.test.ts` — **54/54 passed**.
- `corepack pnpm exec tsc -b --force` followed by `corepack pnpm typecheck` — passed. The forced rebuild is required after the build script cleans project-reference declaration outputs.
- `corepack pnpm lint` — passed, including static import-boundary checks.
- `corepack pnpm build` — passed on Windows x64. Vite reports the existing renderer chunk advisory at 1,004.55 kB minified / 275.62 kB gzip.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "PowerShell prompt coloring reuses bounded profile tokens" --workers=1` — **1/1 passed**, including real `Get-Process |` continuation prompt, command/parameter colors, and Ctrl+C cleanup.
- `git diff --check` — passed.

The first E2E revision waited for PSReadLine to increment the primary-prompt count after Ctrl+C on a secondary prompt; that redraw did not occur. The natural-continuation case now runs in a newly opened PowerShell tab, and the final E2E passed.

## References

- [ADR-0048](../adr/ADR-0048-powershell-natural-continuation-coloring.md)
- [WP-01M code review](WP-01M-review.md)
- Microsoft Learn: [`about_Parsing`](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_parsing)
- Microsoft Learn: [`about_Pipelines`](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_pipelines)
- Microsoft Learn: [`about_Pipeline_Chain_Operators`](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_pipeline_chain_operators)
