# WP-08L: Markdown editor syntax profile

**Requirements:** F-014 / P-27 (partial text-editor syntax coverage)

## Delivered

- Added a dependency-free, CommonMark-oriented Markdown profile to the pure domain tokenizer. `.md` and `.markdown` files auto-detect the profile, which is also available from the syntax selector in local and SFTP editors.
- Added lexical colors for ATX heading markers, list and block-quote markers, thematic breaks, fenced-code delimiters/info/body, same-line code spans, simple emphasis, direct inline links and same-line HTML comments.
- Kept the shared preview limit at 64,000 UTF-16 code units and 4,096 tokens. Each inline lookahead is limited to 512 code units; aggregate lookahead work is limited to 256,000 probe steps per preview. Exhaustion displays the existing truncation notice.
- Updated the architecture, security, specification, implementation plan, feature matrix and user guide. F-014/P-27 remain PARTIAL for broader language coverage and autosave.

## Verification

| Command | Result |
|---|---|
| `corepack pnpm build` | Passed on Windows x64. Renderer bundle is 997.06 kB before gzip; Vite reports its existing advisory for chunks larger than 500 kB. |
| `corepack pnpm typecheck` | Passed. |
| `corepack pnpm lint` | Passed, including static import-boundary checks. |
| `node --test tests/unit/text-syntax.test.ts` | Passed, 28/28. Covers profile extension selection, Markdown block/inline token classes, opaque fenced code, matching fence rules, code-span precedence inside emphasis, individual lookahead, aggregate malformed-link work, character and token bounds. |
| `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "local text editor auto-detects SQL|local YAML text editor auto-detects|local Markdown text editor auto-detects|SFTP sessions verify trust" --reporter=line` | Passed, 4/4 Windows Electron E2Es. Local Markdown checks auto-detection, token colors, full-text retention, the 4,096-token cap, and the complex-input work-limit notice; the SFTP E2E checks `.md` auto-detection, Markdown colors, full-text retention and the same token cap. |
| `git diff --check` | Passed. |

## Limitations and security

The preview remains text-only and does not render, validate, execute, modify or persist Markdown. It is a bounded lexical aid, not a CommonMark parser: nested block containers, setext headings, indented code blocks, reference links, extension syntax and multiline inline constructs are outside this profile. The 256,000-step work budget can leave later text uncolored, and the editor displays that preview truncation while retaining all content for editing. The local editor E2E uses the existing guarded path hook rather than automating native file-picker selection. No dependency was added.

See [ADR-0043](../adr/ADR-0043-markdown-text-syntax-profile.md).

Independent review outcome: [WP-08L review](WP-08L-review.md).
