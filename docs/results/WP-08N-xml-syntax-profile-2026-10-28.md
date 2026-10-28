# WP-08N: XML editor syntax profile

## Requirement coverage

- F-014/P-27: adds bounded renderer-only XML lexical coloring to the shared local and SFTP text editors. `.xml`, `.xsd`, `.xsl`, `.xslt` and `.svg` auto-detect; the user can select XML manually.
- F-014/P-27 remain PARTIAL for broader language coverage and autosave.

## Behavior

- Colors element names and markup delimiters, attribute names, quoted attribute values, comments, CDATA, processing instructions/declarations and bounded text entity references.
- Uses the shared 64,000 UTF-16 code-unit and 4,096-token limits. Entity references are capped at 64 code units; incomplete constructs stay uncolored and all content remains editable.
- Does not resolve entities, render SVG, parse namespaces, validate, execute or change file bytes. No dependency was added.
- XML name scanning is ASCII-oriented. Declarations and CDATA are opaque, and XML is a lexical subset rather than a parser.

## Validation

- `node --test tests/unit/text-syntax.test.ts`: **44 passed, 0 failed**, including extension/manual selection, token classes, malformed markup, DTD internal-subset comments, quoted `>` characters and shared bounds.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm lint`: passed, including import-boundary checks.
- `corepack pnpm build`: passed on Windows x64. Vite reported the existing large-renderer-chunk advisory (1,014.59 kB minified).
- Focused local editor Windows E2E: **1 passed**; verifies auto detection, manual Plain/XML selection, token colors and unchanged file bytes.
- Loopback SFTP Windows E2E: **1 passed**; verifies XML auto detection, token output and unchanged source within the existing transfer/recovery acceptance flow.
- `git diff --check`: passed.

## Architecture and decision

The existing pure-domain tokenizer owns the profile, reused by both editor surfaces. See [ADR-0053](../adr/ADR-0053-xml-text-syntax-profile.md).

## Independent review

- Spec review: approved with no remaining mismatch; confirmed incomplete nested markup is covered and F-014/P-27 remain PARTIAL.
- Standards review: approved; no boundary, security, documented-standard or smell-baseline finding remains.
- Reviewers inspected the final staged diff; validation was run separately as listed above.
