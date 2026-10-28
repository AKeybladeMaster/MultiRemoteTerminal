# WP-08M: INI configuration syntax profile

## Requirement coverage

- F-014/P-27: adds bounded, renderer-only INI-style lexical coloring to the shared local and SFTP text editors. `.ini` and `.cfg` auto-detect; the user can select INI manually.
- F-014/P-27 remain PARTIAL for broader language coverage, autosave and the documented file-replacement platform limitations.

## Behavior

- Colors section headers, trimmed keys, `=`/`:` separators, closed single- or double-quoted values, whole-value decimal/exponent numbers, case-insensitive true/false/yes/no/on/off values, and full-line `;`/`#` comments.
- Uses the existing 64,000 UTF-16 code-unit and 4,096-token limits. Remaining source stays visible and editable.
- Preview rendering does not change or persist file contents, validate configuration, or execute values. No dependency was added.
- Inline comments, quoted keys, multiline/continued values, digit separators and dialect-specific rules are outside this lexical subset. `.cfg` detection is a filename heuristic.

## Validation

- `node --test tests/unit/text-syntax.test.ts`: **42 passed, 0 failed**, including extension/manual profile selection, token categories, malformed input and both shared bounds.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm lint`: passed, including import-boundary checks.
- `corepack pnpm build`: passed on Windows x64. Vite reported the existing large-renderer-chunk advisory (1,011.91 kB minified).
- Focused local editor Windows E2E: **1 passed**; verifies auto detection, Plain/INI manual selection, token output and unchanged file bytes.
- Loopback SFTP Windows E2E: **1 passed**; verifies auto detection and token output in the remote editor, unchanged remote fixture bytes, and existing transfer/recovery acceptance.
- `git diff --check`: passed.

The UI E2Es use guarded test-selected paths; native picker cancellation and selection are covered separately by WP-08D.

## Architecture and decision

The existing pure domain tokenizer owns the new profile. Both editor surfaces reuse the shared profile selector, accessible textarea, aria-hidden preview and theme token classes. No IPC, storage, file-save, or terminal behavior changed. See [ADR-0052](../adr/ADR-0052-ini-text-syntax-profile.md).

## Independent review

- Spec review: identified missing coverage for an unterminated quoted value. Added an assertion that the value remains uncolored; `node --test tests/unit/text-syntax.test.ts` passed (42/42).
- Standards review: no documented-standard breach or reportable baseline smell found.
- Final staged-diff review completed after the regression assertion was added.
