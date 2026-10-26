# ADR-0023: Bounded syntax color profiles for text editing

**Status:** Accepted for WP-08E, 2026-10-26

## Context

F-014 asks for syntax color profiles in the local and remote text editors. The editors must keep source text editable through the existing textarea and must not evaluate file contents or add unnecessary parser dependencies. Shell files benefit from zsh/bash-like token colors, while JSON configuration benefits from distinct key/value colors.

## Decision

- Add one pure domain tokenizer that returns token ranges for `plain`, `shell` and `json` profiles. The `auto` selector resolves `.sh`, `.bash`, `.zsh`, `.ksh` and `.json` file names; the user can override the profile for the open file.
- Shell coloring is a bounded lexical aid for command-position words, shell keywords, options, quoted text, variables, comments, operators and paths. JSON coloring distinguishes keys, strings, numbers, literals and punctuation. Neither profile validates source syntax or command availability.
- Keep the native textarea as the only editing and accessibility surface. A renderer component draws token spans in an aria-hidden overlay and synchronizes its scroll position. JSX renders all source slices as text; no HTML, shell command or file content is evaluated.
- Stop tokenizing after 64,000 UTF-16 code units or 4,096 tokens for a render. Show the remainder as plain editable text and disclose the syntax preview limit. The source file remains governed by the existing 512 KiB editor bound.
- Use existing light/dark theme colors and add no package. Profile selection is local to the current editor selection and is not persisted.

## Consequences

The UI provides readable colors for common Shell and JSON forms without changing bytes saved to the local or remote file. Shell interpretation is intentionally lexical and may color text that a full grammar would classify differently. Other languages, full error checking, editor autosave, terminal shell grammar and remote shell integration remain out of scope for this slice.

## Verification

See [WP-08E text syntax profile results](../results/WP-08E-text-syntax-profiles-2026-10-26.md).
