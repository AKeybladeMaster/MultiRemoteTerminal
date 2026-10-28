# WP-08P: Environment-file syntax profile

## Requirement coverage

- F-014/P-27: both local and SFTP text editors now offer a manually selectable `dotenv` preview and auto-detect `.env`, `.env.*` and `*.env` basenames.
- The bounded lexical view colors ASCII assignment keys and separators, optional `export`, closed quoted or unquoted values, full-line comments and whitespace-separated inline comments. Values remain text; no expansion or execution occurs.
- F-014/P-27 remain PARTIAL for broader language-profile coverage and full editor acceptance.

## Architecture and security

- The existing pure domain tokenizer owns the profile and reuses the editor's shared accessible textarea and aria-hidden preview.
- The scanner uses the shared 64,000 UTF-16 code-unit and 4,096-token limits. It leaves a line plain if the code-unit bound ends inside it.
- Preview rendering does not alter file bytes, persist values, log contents, expand variables, interpret escapes, or validate a dotenv dialect. No dependency, IPC, storage schema or save behavior was added.

## Validation

- `node --test tests/unit/text-syntax.test.ts`: **46 passed, 0 failed**.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm lint`: passed, including static import-boundary checks.
- `corepack pnpm build`: passed for Windows x64; existing Vite large-renderer-chunk advisory remains.
- Local Windows editor E2E: **1 passed**; verifies `.env.local` detection, token colors, manual Plain/profile switching, exact preview text and unchanged source bytes.
- SFTP loopback Windows E2E: **1 passed**; verifies `.env.production` detection, token colors, manual Plain/profile switching, exact preview text and unchanged remote bytes.
- `corepack pnpm test`: **575 passed, 1 failed**. The unrelated release-script test `Windows distribution SBOM refuses a pnpm CLI that differs from the repository pin` expected its pnpm-version assertion, but this workstation runs Node 24.14.0 while the repository pins Node 24.14.1; the script exits on the Node check before reaching that assertion.
- `git diff --check`: passed.

## Independent review

- **Spec:** approved after correcting the `#` boundary so `KEY=#literal` remains an unquoted value and adding a regression. No remaining mismatch or scope creep.
- **Standards:** approved after adding this result record and reusing the existing quoted-value scanner. No hard breach or remaining code-smell finding.

## Remaining limits

This is a lexical readability aid, not a dotenv parser. Multiline values, line continuations, variable expansion, escape interpretation and dialect-specific rules are unsupported. F-014/P-27 remain PARTIAL.
