# ADR-0046: PowerShell terminal prompt coloring

**Status:** Accepted for WP-01K, 2026-10-27

## Context

WP-01G through WP-01J add opt-in lexical colors to active Shell input in xterm. The local and SFTP editors already share a bounded pure PowerShell tokenizer that recognizes common commands, keywords, parameters, variables, strings, comments, operators, numbers and simple types. Reimplementing or importing a PowerShell parser into the terminal renderer would duplicate language rules and increase dependency/security scope.

## Decision

- Reuse the existing PowerShell tokenizer for active input when xterm's visible normal-buffer line matches the common `PS <path>>` prompt form. Keep the existing Shell prompt endings and Shell tokenizer behavior.
- Preserve the existing opt-in preference and schema. Treat a detected PowerShell anchor as a distinct transient input profile; never apply Shell backslash-continuation state to it.
- Map the existing PowerShell token kinds to the current terminal theme roles and reuse the existing 2,048-code-unit, 128-row and 64-decoration limits and xterm marker cleanup.
- Read only input explicitly typed into xterm's parsed normal buffer. Do not rewrite, transmit for highlighting, persist or log input; do not inspect the installed shell, resolve commands or validate/execute text.

## Consequences and limits

PowerShell commands, parameters and other recognized lexical tokens are colored while the user types at the common prompt. Custom PowerShell prompt functions, secondary prompts, continuation syntax and full PowerShell grammar are not detected. This is a visual hint rather than syntax validation. The feature remains opt-in and P-30 remains PARTIAL.

## Verification

See [WP-01K acceptance results](../results/WP-01K-powershell-terminal-prompt-coloring-2026-10-27.md).
