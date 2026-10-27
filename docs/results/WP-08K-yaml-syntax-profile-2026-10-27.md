# WP-08K: YAML editor syntax profile

**Requirements:** F-014 / P-27 (partial text-editor syntax coverage)

## Delivered

- Added a dependency-free YAML profile to the pure domain tokenizer, with `.yaml` and `.yml` automatic detection and manual selection in local and SFTP editors.
- Added bounded color tokens for mapping keys, quoted/plain scalars, YAML 1.2 core null/boolean/numeric forms, separated comments, flow punctuation, document markers/directives, tags, anchors/aliases and opaque block scalar text.
- Kept the shared preview limit at 64,000 UTF-16 code units and 4,096 tokens. Implicit-key lookahead is capped at 1,024 UTF-16 code units on one line.
- Updated architecture, security, specification, implementation plan, feature matrix and user guide. F-014/P-27 remain PARTIAL; this is lexical coloring, not YAML parsing or validation.

## Verification

| Command | Result |
|---|---|
| `corepack pnpm build` | Passed. Existing Vite bundle-size advisory remains; the renderer bundle is 991.31 kB before gzip. |
| `corepack pnpm typecheck` | Passed. |
| `corepack pnpm lint` | Passed, including static import-boundary checks. |
| `node --test tests/unit/text-syntax.test.ts` | Passed, 22/22. Covers profile detection, keys/scalars/comments, flow syntax, tags/anchors/aliases, directives, block scalars and preview limits. |
| `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "local text editor auto-detects SQL\|local YAML text editor auto-detects\|SFTP sessions verify trust" --reporter=line` | Passed, 3/3 Windows Electron E2Es. Covers manual YAML selection, local `.yaml` auto-detection and cap/full-text retention, and remote SFTP `.yaml` auto-detection. |

## Limitations and security

No dependency was added. Preview tokenization does not execute, validate, change or persist file content. The scanner uses a simple indentation approximation for block scalars and does not model YAML grammar, schema selection, tag resolution or plain-scalar folding. The editor's existing guarded local-file E2E path remains separate from native picker acceptance.

See [ADR-0042](../adr/ADR-0042-yaml-text-syntax-profile.md).
