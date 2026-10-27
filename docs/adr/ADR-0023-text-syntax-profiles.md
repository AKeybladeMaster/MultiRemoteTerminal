# ADR-0023: Bounded syntax color profiles for text editing

**Status:** Accepted for WP-08E, extended by WP-08F on 2026-10-27

## Context

F-014 asks for syntax color profiles in the local and remote text editors. The editors must keep source text editable through the existing textarea and must not evaluate file contents or add unnecessary parser dependencies. Shell files benefit from zsh/bash-like token colors, while JSON configuration benefits from distinct key/value colors.

## Decision

- Add one pure domain tokenizer that returns token ranges for `plain`, `shell`, `powershell` and `json` profiles. The `auto` selector resolves `.sh`, `.bash`, `.zsh`, `.ksh`, `.ps1`, `.psm1`, `.psd1`, `.pssc` and `.json` file names; the user can override the profile for the open file.
- Shell coloring is a bounded lexical aid for command-position words, shell keywords, options, quoted text, variables, comments, operators and paths. PowerShell coloring recognizes common command-position words, keywords, dash-word parameters/operators, variables, quoted strings and here-strings, comments, numeric literals and simple type literals. JSON coloring distinguishes keys, strings, numbers, literals and punctuation. No profile validates source syntax or command availability.
- Keep the native textarea as the only editing and accessibility surface. A renderer component draws token spans in an aria-hidden overlay and synchronizes its scroll position. JSX renders all source slices as text; no HTML, shell command or file content is evaluated.
- Stop tokenizing after 64,000 UTF-16 code units or 4,096 tokens for a render. Show the remainder as plain editable text and disclose the syntax preview limit. The source file remains governed by the existing 512 KiB editor bound.
- Use existing light/dark theme colors and add no package. Profile selection is local to the current editor selection and is not persisted.

## Consequences

The UI provides readable colors for common Shell, PowerShell and JSON forms without changing bytes saved to the local or remote file. Shell and PowerShell interpretation is intentionally lexical and may color text that a full grammar would classify differently; PowerShell names and command-position detection are bounded heuristics, not a parser. Other languages, full error checking, editor autosave, terminal shell grammar and remote shell integration remain out of scope.

## Verification

See [WP-08E text syntax profile results](../results/WP-08E-text-syntax-profiles-2026-10-26.md).

WP-08F extends this decision with the bounded PowerShell profile; see [ADR-0037](ADR-0037-powershell-text-syntax-profile.md) and [WP-08F results](../results/WP-08F-powershell-syntax-profile-2026-10-27.md).
