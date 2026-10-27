# ADR-0048: Selected natural PowerShell continuation coloring

**Status:** Accepted for WP-01M, 2026-10-27

## Context

WP-01L carries bounded lexical flags across an explicit trailing backtick. Microsoft documents natural line breaks after pipe characters, binary operators, commas and opening delimiters; a pipeline's final `|` joins the next line. This slice extends coloring for a selected set of trailing operators while retaining the same `>>` prompt route and transient renderer state. It does not add a PowerShell parser or retain submitted text.

See Microsoft's [`about_Parsing` line-continuation guidance](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_parsing), [`about_Pipelines` intrinsic continuation guidance](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_pipelines), and [`about_Pipeline_Chain_Operators`](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_pipeline_chain_operators) for `&&`/`||` right-hand pipelines.

## Decision

- The pure domain tokenizer returns its existing two command-position flags when complete bounded input ends with a recognized pipeline, binary, assignment, logical or array-separator operator, optionally followed by whitespace. `&&` and `||` also start command position for the right-hand pipeline.
- String and comment tokens are never treated as continuation operators. A truncated or over-limit scan returns no state.
- The renderer carries the flags only for the same terminal, to the exact visible `>>` prompt, and only when the caret is at an unambiguous logical input end. The existing wrap-pending final-cell case fails closed.
- Carry no command text. Do not add IPC, persistence, command execution or dependencies. Preserve the existing opt-in preference, 2,048-code-unit, 128-row and 64-decoration bounds, and cancellation/close cleanup.
- Do not infer state from a leading pipe, unmatched opening delimiters, quoted lines, or unsupported PowerShell grammar. The renderer remains a bounded lexical color hint.

## Consequences and limits

Common trailing pipeline and expression operators can color command-position tokens on the `>>` row. Open parentheses/braces/brackets that span rows, quoted continuations, comments after operators, leading-pipe paste, other natural continuation forms and full PowerShell grammar remain unsupported. P-30 remains PARTIAL.

## Verification

See [WP-01M acceptance results](../results/WP-01M-powershell-natural-continuations-2026-10-27.md).
