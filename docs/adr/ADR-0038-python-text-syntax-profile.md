# ADR-0038: Bounded Python syntax profile for text editing

**Status:** Accepted for WP-08G, 2026-10-27

## Context

F-014/P-27 now provide shared renderer-only Shell, PowerShell and JSON previews in local and SFTP text editors. Python files are another common script/configuration format. A full Python parser is unnecessary for a visual aid and would add dependencies; the existing pure tokenizer, preview limits and textarea/overlay can support common lexical forms.

Python's official [lexical analysis reference](https://docs.python.org/3/reference/lexical_analysis.html) describes comments, identifiers, operators, numeric literals, quoted/triple-quoted strings and string prefixes.

## Decision

- Extend the shared pure domain tokenizer with a `python` profile. Auto detection recognizes `.py`, `.pyw` and `.pyi`; users can manually choose Python for other text files.
- Color common keywords, function/class declaration names, builtin names, prefixed and triple-quoted strings, comments, numeric literals and operators.
- Reuse the existing semantic theme colors, accessible textarea, aria-hidden preview overlay, 64,000 UTF-16 code-unit bound and 4,096-token bound. Add no package and leave file bytes unchanged.
- Keep highlighting renderer-only. Do not execute or validate the source, persist its contents, or send them through a new channel.
- Treat this as a lexical aid, not a parser. String contents, including f-string expressions, stay one string token. Name recognition is ASCII-oriented; soft-keyword contexts and the full Python grammar are not parsed.

## Consequences

Common Python constructs receive consistent colors in both local and SFTP editors. The preview can color identifiers or soft keywords differently from a full parser, and it does not identify syntax errors, runtime behavior or interpreter availability. Broader language support and autosave remain open under F-014/P-27.

## Verification

See [WP-08G Python syntax profile results](../results/WP-08G-python-syntax-profile-2026-10-27.md).
