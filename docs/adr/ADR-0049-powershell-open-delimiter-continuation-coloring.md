# ADR-0049: Bounded PowerShell open-delimiter continuation coloring

**Status:** Accepted for WP-01N, 2026-10-28

## Context

WP-01M carries command-position flags across selected natural trailing operators but intentionally leaves delimiters that span prompt rows unsupported. Microsoft documents line breaks after opening `[`, `{`, and `(` characters. The renderer already routes transient PowerShell state through the exact `>>` prompt and bounded normal-buffer preview.

See Microsoft's [`about_Parsing` line-continuation guidance](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_parsing) and [PowerShell 101 pipeline guidance](https://learn.microsoft.com/en-us/powershell/scripting/learn/ps101/04-pipelines).

## Decision

- Extend the existing domain continuation state with an optional stack containing only expected closing characters `)`, `]`, and `}`. Carry at most 32 nesting levels; do not carry delimiter positions or command text.
- Track only unescaped opening/closing delimiter operator tokens outside the tokenizer's string and comment tokens. A mismatch, unmatched closer, stack overflow, incomplete quote or incomplete here-string/block comment returns no continuation state.
- Continue to require a complete bounded scan and let the renderer carry state only for the same terminal to an exact `>>` prompt at an unambiguous logical input end. Preserve the opt-in preference and current row, character, and decoration limits.
- Keep the tokenizer a lexical color hint. Do not add parser/runtime dependencies, IPC, persistence, command execution, or shell text retention.

## Consequences and limits

Common nested expressions, array subexpressions, and script blocks can carry command-position colors across `>>` rows while their delimiters balance. Quoted continuation, here-string continuation, incomplete block comments, leading-pipe paste, other PowerShell grammar and broad interoperability remain unsupported. An invalid or over-depth stack fails closed. P-30 remains PARTIAL.

## Verification

WP-01N acceptance requires bounded domain coverage for nesting, balancing, mismatches, escapes, opaque text, invalid input state and overflow, plus a Windows E2E that enters a multirow array subexpression and verifies command/parameter colors before closing it. See [WP-01N results](../results/WP-01N-powershell-open-delimiters-2026-10-28.md).
