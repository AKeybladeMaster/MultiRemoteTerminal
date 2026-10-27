# ADR-0037: Bounded PowerShell syntax profile for text editing

**Status:** Accepted for WP-08F, 2026-10-27

## Context

F-014/P-27 already provide shared, renderer-only Shell and JSON color previews in local and remote text editors. PowerShell scripts are another common text-file type, but adding a full parser would expand dependencies and would imply validation the editor does not provide. The existing profile interface, token palette, preview bounds and accessible textarea/overlay can cover common forms with a pure lexical scanner.

PowerShell quoting and here-strings have language-specific delimiters and escape behavior, while comments include line and block forms. Official language references describe these forms in [about_Quoting_Rules](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_quoting_rules?view=powershell-7.5), [about_Comments](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_comments?view=powershell-7.6) and [about_Operators](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_operators?view=powershell-7.5).

## Decision

- Extend the shared pure domain tokenizer with a `powershell` profile. Auto detection recognizes `.ps1`, `.psm1`, `.psd1` and `.pssc`; the profile selector also allows an explicit PowerShell choice for other files.
- Color common keywords, command-position words, dash-word parameters and comparison/logical operators, variables, quoted strings, here-strings, line/block comments, numeric literals and simple bracketed type names.
- Reuse the existing theme semantic colors and the 64,000 UTF-16 code-unit and 4,096-token preview bounds. Add no package and leave the file content and saved bytes untouched.
- Keep the existing textarea as the editing/accessibility surface. Render token spans only in the aria-hidden preview overlay. Do not execute, validate, persist or send source text as part of highlighting.
- Describe this as a lexical readability aid. Command-position and type recognition are heuristics; this is not a PowerShell parser and does not diagnose syntax or cmdlet availability.

## Consequences

The same profile works in local and SFTP text editors because they share `TextEditorContent`. Common PowerShell constructs receive consistent colors, but nested interpolation, Unicode identifiers, the full type grammar, line continuation semantics and other language details are not fully parsed. The user can select Plain text when colors are distracting. Broader profiles and editor autosave remain open under F-014/P-27.

## Verification

See [WP-08F PowerShell syntax profile results](../results/WP-08F-powershell-syntax-profile-2026-10-27.md).
