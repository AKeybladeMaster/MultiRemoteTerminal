# WP-08G Python syntax profile results

**Date:** 2026-10-27
**Requirements:** F-014, P-27 (both remain PARTIAL)
**Branch:** `dev`

## Delivered

- Added a pure, bounded Python lexical profile to the shared text-syntax tokenizer.
- Auto-detected `.py`, `.pyw` and `.pyi`; added manual Python selection for local and SFTP editors.
- Colored common keywords, declared function and class names, documented built-in function/type names, prefixed and triple-quoted strings, comments, numeric literals and operators.
- Kept the existing textarea as the editing surface and the token display in its aria-hidden preview. The preview is limited to 64,000 UTF-16 code units and 4,096 tokens, adds no dependency, and does not execute, validate, persist or modify source text.
- Updated the feature matrix, implementation plan, specification, architecture, security notes, user guide and ADRs.

## Validation

| Check | Result |
|---|---|
| `corepack pnpm build` | Passed on Windows x64. Vite emitted the renderer-size warning for the 976.00 kB JavaScript chunk (500 kB threshold). |
| `corepack pnpm typecheck` | Passed. |
| `corepack pnpm lint` | Passed; static import-boundary check passed. |
| `node --test tests/unit/text-syntax.test.ts` | 13 passed, 0 failed. |
| `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "local text editor auto-detects Python|SFTP sessions verify trust"` | 2 Windows E2Es passed in 40.1 seconds (local editor and SFTP editor coverage). |
| `git diff --check` | Passed. |

## Limits

This is a lexical color aid, not a Python parser or validator. F-string contents remain one string token, identifiers are ASCII-oriented, soft-keyword context and full grammar are not parsed, and interpreter availability is not checked. Broader language coverage and autosave remain open under F-014/P-27.

## Review

Initial independent review found two issues: the security guide still described syntax previews as unimplemented for SFTP, and the builtin set omitted documented names including `complex` and `dir`. Both were corrected; final review outcomes are recorded in [WP-08G review](WP-08G-review.md).
