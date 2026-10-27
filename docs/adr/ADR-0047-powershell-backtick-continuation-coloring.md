# ADR-0047: PowerShell backtick continuation coloring

**Status:** Accepted for WP-01L, 2026-10-27

## Context

WP-01K colors active input at the common `PS <path>>` prompt using the bounded PowerShell tokenizer. PowerShell also uses an explicit trailing backtick to continue an input line and displays `>>` while waiting for the remainder. Microsoft's [`about_Parsing` guidance](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_parsing) documents that trailing whitespace breaks this continuation and distinguishes natural continuation points. Treating the secondary prompt as Shell input would select the wrong tokenizer; retaining submitted text to re-tokenize the command would exceed the renderer's current transient-state design.

## Decision

- Let the pure domain tokenizer return a small continuation state only when the full bounded input ends with an odd run of backticks outside a string, here-string or comment. Trailing whitespace and an even run do not continue; a truncated preview does not return state.
- Carry that state only in renderer memory for the same terminal. Recognize PowerShell's secondary prompt only as the exact visible `>>` text, and consume state once when creating the next input anchor.
- Carry state only when the caret is at the end of the logical input. Check the current row and subsequent xterm-wrapped rows within the existing row and line bounds; if the buffer is incomplete or exceeds those bounds, fail closed without carrying state.
- At the terminal's right margin, xterm may leave `cursorX` on the last occupied cell while delayed wrapping is pending. Its public buffer API does not distinguish that position from a caret before the cell, so fail closed and withhold continuation state in this ambiguous case.
- Keep the state to command-position flags. Never retain, log, persist, validate or execute the submitted line for coloring.
- Preserve the existing opt-in preference, buffer/row/token/decoration limits, transient xterm markers and cleanup paths. Do not mix this state with Shell's backslash continuation state.

## Consequences and limits

Parameters and variables on a continuation row retain their existing token colors when the first line ends in an unquoted odd trailing backtick and xterm exposes an unambiguous caret-at-end position. Prompt recognition is shape-based, so a custom prompt that is exactly `>>` can match when state is pending. Quoted backticks, PowerShell's natural continuation forms, custom secondary prompts, right-margin wrap-pending positions, multiline grammar and full parser behavior are not supported. This remains a visual lexical hint and P-30 remains PARTIAL.

## Verification

See [WP-01L acceptance results](../results/WP-01L-powershell-backtick-continuation-2026-10-27.md).
