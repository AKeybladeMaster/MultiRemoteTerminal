# ADR-0041: Bounded TOML syntax profile

**Status:** Accepted for WP-08J, 2026-10-27

## Context

F-014/P-27 provide local and SFTP text editors with bounded, renderer-only syntax previews. TOML is commonly used for application and service configuration. A full parser would add grammar and validation concerns to an optional readability aid; the existing pure domain tokenizer can color common lexical forms without changing editor behavior.

The [TOML v1.0.0 specification](https://toml.io/en/v1.0.0.html) defines bare and quoted keys, dotted keys, table and array-of-table headers, basic and literal strings in single-line and multiline forms, numbers, booleans, date/time values, and comments.

## Decision

- Add a `toml` profile to the shared tokenizer. Auto detection recognizes `.toml`; users may also select TOML manually.
- Color bare and quoted keys; basic, literal, multiline basic and multiline literal strings; common decimal/based integers and floats; booleans and signed `inf`/`nan`; common local date/time forms; `#` comments outside strings; and table, array, inline-table and dotted-key punctuation.
- Reuse the accessible textarea, aria-hidden overlay, semantic theme colors, 64,000 UTF-16 code-unit preview limit and 4,096-token limit. Add no package; the preview does not validate, execute, modify or persist content.
- Keep bare-key character recognition ASCII-oriented and cap dotted-key assignment lookahead at 512 UTF-16 code units. Leave unknown bare values and unsupported or malformed forms uncolored rather than treating this profile as a validator.
- Treat the profile as a lexical readability aid, not a TOML parser. It does not validate escape sequences, date/time ranges, duplicate keys, table rules or the full Unicode key grammar.

## Consequences

Common TOML settings remain readable in both editors without changing source text. Unicode bare keys may be left uncolored, and malformed input can receive colors that resemble valid tokens. The preview's bounds keep work and token output finite; the remainder stays editable and plain.

## Verification

See [WP-08J TOML syntax profile results](../results/WP-08J-toml-syntax-profile-2026-10-27.md).
