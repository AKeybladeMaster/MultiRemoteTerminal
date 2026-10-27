# WP-08K: YAML editor syntax profile

**Requirements:** F-014 / P-27 (partial text-editor syntax coverage)

## Delivered

- Added a dependency-free YAML profile to the pure domain tokenizer, with `.yaml` and `.yml` automatic detection and manual selection in local and SFTP editors.
- Added bounded color tokens for mapping keys, quoted scalars, complete same-line plain scalars, YAML 1.2 core null/boolean/numeric forms, separated comments, flow punctuation, document markers/directives, tags, anchors/aliases and opaque block scalar text.
- Kept the shared preview limit at 64,000 UTF-16 code units and 4,096 tokens. Implicit-key lookahead is capped at 1,024 UTF-16 code units on one line.
- Updated architecture, security, specification, implementation plan, feature matrix and user guide. F-014/P-27 remain PARTIAL; this is lexical coloring, not YAML parsing or validation.

## Review follow-up

Independent review caught flow-map values being considered as keys, core scalars being classified word-by-word, sequence indicators inside scalars receiving operator colors, alias-key colons being absorbed, and compact sequence mappings using the wrong block-scalar indentation base. These cases are now covered by domain regressions; local and SFTP Windows E2Es verify compact block-scalar text stays opaque while following sibling keys remain colored. Additional regressions cover flow-sequence pairs, nested compact-sequence mappings and low-token malformed-input scan bounds. Both editors verify the 4,096-token preview cap while retaining the full YAML source; anchor and alias names share one bounded property-name scanner.

## Verification

| Command | Result |
|---|---|
| `corepack pnpm build` | Passed. Existing Vite bundle-size advisory remains; the renderer bundle is 991.51 kB before gzip. |
| `corepack pnpm typecheck` | Passed. |
| `corepack pnpm lint` | Passed, including static import-boundary checks. |
| `node --test tests/unit/text-syntax.test.ts` | Passed, 24/24. Covers profile detection, whole keys/scalars/comments, flow syntax and sequence pairs, tags/anchors/aliases, directives, nested block scalars, preview limits and a low-token malformed-input performance bound. |
| `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "local text editor auto-detects SQL\|local YAML text editor auto-detects\|SFTP sessions verify trust" --reporter=line` | Passed, 3/3 Windows Electron E2Es. Covers manual YAML selection, local and remote `.yaml` auto-detection, block-scalar opacity, and 4,096-token notices with full source retention in both editors. |
| `git diff --check` | Passed. |

## Limitations and security

No dependency was added. Preview tokenization does not execute, validate, change or persist file content. The scanner uses a simple indentation approximation for block scalars and does not model YAML grammar, schema selection, tag resolution or plain-scalar folding. The editor's existing guarded local-file E2E path remains separate from native picker acceptance.

See [ADR-0042](../adr/ADR-0042-yaml-text-syntax-profile.md).
