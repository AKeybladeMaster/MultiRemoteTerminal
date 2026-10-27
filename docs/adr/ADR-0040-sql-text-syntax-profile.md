# ADR-0040: Bounded PostgreSQL-oriented SQL syntax profile

**Status:** Accepted for WP-08I, 2026-10-27

## Context

F-014/P-27 provide the local and SFTP text editors with bounded, renderer-only syntax previews. SQL scripts are common files users may inspect or edit. A full SQL parser would add dialect and grammar maintenance to an optional readability aid; the existing pure domain tokenizer can color common lexical forms without changing editor architecture or file behavior.

The [PostgreSQL 18 lexical structure reference](https://www.postgresql.org/docs/18/sql-syntax-lexical.html) documents case-insensitive unquoted keywords and identifiers, quoted identifiers, string and dollar-quoted constants, positional `$n` parameters, operators, and line and nested block comments. It also describes a default 63-byte identifier limit. PostgreSQL syntax is not identical to every SQL dialect.

## Decision

- Add a `sql` profile to the shared tokenizer. Auto detection recognizes `.sql`, `.pgsql` and `.psql`; users can also select SQL manually.
- Color common keywords and boolean/null literals, common PostgreSQL types, a fixed set of common function names when followed by a call parenthesis, quoted identifiers, single-quoted strings (including `E`, `B` and `X` prefixes), dollar-quoted strings, positional `$n` parameters, decimal/exponent numbers, `--` line comments, nested `/* ... */` comments and common operators.
- Reuse the accessible textarea, aria-hidden overlay, semantic theme colors, 64,000 UTF-16 code-unit preview limit and 4,096-token limit. Add no dependency; do not validate, execute, modify or persist content through the preview.
- Keep name scanning ASCII-oriented. Bound dollar-quote tag length to 63 ASCII characters, matching PostgreSQL's default identifier limit and keeping delimiter search work bounded.
- Treat this as a PostgreSQL-oriented lexical subset, not a SQL parser or validator. It does not recognize Unicode identifiers or `U&` escape syntax and does not try to resolve dialect-specific keyword, type, parameter or operator rules.

## Consequences

Common SQL constructs receive readable colors in both editors while source bytes remain unchanged until the editor's explicit save action. Some words may be colored as keywords or types when a particular dialect treats them as identifiers. User-defined functions outside the fixed list remain uncolored. Non-PostgreSQL SQL may need a manual Plain profile. PostgreSQL builds configured with a larger identifier limit can use dollar-quote tags this preview leaves uncolored.

## Verification

See [WP-08I SQL syntax profile results](../results/WP-08I-sql-syntax-profile-2026-10-27.md).
