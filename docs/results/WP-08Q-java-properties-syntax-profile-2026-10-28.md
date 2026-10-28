# WP-08Q: Java Properties syntax profile

## Requirement coverage

- F-014/P-27: the local and SFTP editors auto-detect .properties files and offer a manual Java Properties profile.
- The bounded lexical view colors leading #/! comments, escaped keys, whitespace or punctuation separators and raw values. Inline comment markers remain value text. Physical lines in a continued logical entry remain uncolored.
- F-014/P-27 remain PARTIAL for broader language-profile coverage and full editor acceptance.

## Architecture and security

- The existing pure-domain tokenizer owns the profile and reuses the shared accessible textarea and aria-hidden preview.
- The scanner uses the shared 64,000 UTF-16 code-unit and 4,096-token limits. It leaves a physical line plain if the code-unit bound ends inside it.
- Preview rendering does not alter file bytes, persist or log content, decode escapes, parse, validate or execute source text. No dependency, IPC, storage schema or save behavior was added.
- Continued entries remain uncolored rather than allowing a continuation line to appear as an unrelated property.

## Validation

- node --test tests/unit/text-syntax.test.ts: **48 passed, 0 failed**.
- corepack pnpm typecheck: passed after a forced TypeScript build following the renderer build.
- corepack pnpm lint: passed, including static import-boundary checks.
- corepack pnpm build: passed for Windows x64. Vite reported the existing large-renderer-chunk advisory; the renderer bundle is 1,018.22 kB before gzip. No installer or portable package was produced by this slice.
- Focused Windows Electron command corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "Java properties|SFTP sessions verify trust and transfers": **2 passed**. This covers local profile detection/selection/source preservation and the integrated loopback SFTP flow with the new remote Properties file.
- corepack pnpm test: **577 passed, 1 failed**. The unrelated release-script test Windows distribution SBOM refuses a pnpm CLI that differs from the repository pin expected the pnpm-version assertion, but this workstation runs Node 24.14.0 while the repository pins Node 24.14.1; the script exits on the Node check before reaching the pnpm assertion.
- git diff --check: passed.

## Independent review

- Spec review: approved; no mismatch, scope creep or incorrect behavior found.
- Standards review: approved; no documented-standard breach or reportable smell found.
- The requesting-code-review skill file was absent from both configured local skill roots; the available two-axis code-review workflow supplied the independent reviews.

## Remaining limits

This is a lexical readability aid, not a Java Properties parser. It does not decode escapes or combine physical lines; continued logical entries are left uncolored. It does not validate malformed Unicode escapes, key/value semantics, stream encodings or Java runtime behavior. F-014/P-27 remain PARTIAL.
