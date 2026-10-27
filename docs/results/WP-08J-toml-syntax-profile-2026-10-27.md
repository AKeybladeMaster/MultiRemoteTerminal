# WP-08J — TOML editor syntax profile

**Date:** 2026-10-27  
**Platform:** Windows x64, Node.js 24.14.1  
**Status:** Partial

## Delivered

- Added a dependency-free TOML lexical profile in the pure domain tokenizer. `.toml` names auto-select TOML; local and SFTP editors also expose manual selection.
- Colored bare and quoted keys, basic/literal and multiline strings, common integer/float forms, booleans and signed `inf`/`nan`, local date/time values, comments outside strings, dotted keys and table/array punctuation.
- Preserved the 64,000 UTF-16 code-unit and 4,096-token bounds. Preview content remains text and is neither validated, executed, modified nor persisted.
- Added tests for the four TOML string forms, escaped text, embedded comment markers, dotted/quoted/table keys, number and date/time forms, literal values, automatic extension selection, theme colors and both preview bounds. Local and SFTP editor E2E verify profile selection and colored content.
- Added [ADR-0041](../adr/ADR-0041-toml-text-syntax-profile.md) and updated the architecture, security, feature matrix, specification, implementation plan and user guide.

## Validation

On Windows x64:

- `corepack pnpm build` — passed. Vite reported the existing bundle-size advisory; the renderer bundle is 986.19 kB before gzip.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including static import-boundary checks.
- `node --test tests/unit/text-syntax.test.ts` — 19/19 passed.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "local text editor auto-detects SQL|local TOML text editor auto-detects|SFTP sessions verify trust"` — 3/3 passed. This covers local manual TOML selection, local `.toml` auto-detection, and remote `.toml` auto-detection in the SFTP fixture.
- `git diff --check` — passed.

## Limits

This is a lexical preview, not a TOML parser or validator. Bare-key recognition is ASCII-oriented and dotted-key assignment lookahead is capped at 512 UTF-16 code units. Escape validity, date/time ranges, duplicate keys, table rules and the full Unicode key grammar are not checked. F-014/P-27 remain PARTIAL for broader syntax profiles and autosave.
