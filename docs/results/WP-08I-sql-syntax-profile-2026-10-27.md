# WP-08I — PostgreSQL-oriented SQL editor syntax profile

**Date:** 2026-10-27 · **Requirements:** F-014, P-27
**Status:** Partial slice accepted; broader F-014/P-27 work remains open.

## Delivered

- Added a shared `sql` syntax profile to the pure domain tokenizer. Auto detection covers `.sql`, `.pgsql` and `.psql`; the profile can also be selected manually in local and SFTP editors.
- Added bounded coloring for common case-insensitive keywords and literals, common PostgreSQL types, a fixed set of function names, quoted identifiers, standard and `E`/`B`/`X` single-quoted strings, dollar-quoted strings, `$n` parameters, decimal/exponent numbers, line comments, nested block comments and common operators.
- Reused the existing accessible textarea, aria-hidden preview, semantic theme palette and 64,000 UTF-16 code-unit/4,096-token limits. No package, SQL execution or persistence path was added.
- Updated ADR-0040, architecture, security, feature matrix, implementation plan, specification and user guide.

The profile is a PostgreSQL-oriented lexical aid, not a parser or validator. Unquoted identifier scanning is ASCII-oriented, dollar-quote tags are capped at 63 ASCII characters, and only a fixed set of common function names is colored. Other SQL dialects may use Plain or another manual profile.

## Validation

Validated on Windows 11 x64 with Node.js 24.14.1:

- `corepack pnpm build` — passed; existing Vite renderer-chunk advisory remains (983.48 kB minified versus the 500 kB advisory threshold).
- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including static import-boundary checks.
- `node --test tests/unit/text-syntax.test.ts` — 17/17 passed.
- Focused Windows Electron E2E — 2/2 passed. The local editor verifies SQL extension detection, token colors, opaque E/dollar-quoted strings, nested block comments, manual profile switching, both preview bounds and full-text editability after truncation. The SFTP flow verifies `.sql` auto-detection and SQL token categories while retaining the no-unrequested-shell assertion.
- `git diff --check` — passed.

An early feature-level run caught an overbroad function-name heuristic that colored table identifiers before `(`. Recognition now uses a fixed common-function set. The final suite also confirms `$n` text inside quoted strings is not emitted as a parameter token.

## Source reference

The lexical scope follows the [PostgreSQL 18 lexical structure reference](https://www.postgresql.org/docs/18/sql-syntax-lexical.html), including quoted identifiers, constants, positional parameters, operators and nested block comments.

## Remaining acceptance

F-014/P-27 remain PARTIAL for additional language profiles, autosave and wider editor acceptance. This profile does not establish correctness for every PostgreSQL server configuration or other SQL dialect.
