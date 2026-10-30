# ADR-0057: Bounded HTML text syntax profile

- **Status:** Accepted
- **Date:** 2026-10-30
- **Requirement:** F-014 / P-27

## Context

The local and SFTP editors share a bounded pure-domain lexical preview. HTML files were not auto-detected even though the editor already supports a related XML profile. Reusing XML rules would miscolor browser raw-text elements such as `script` and `style`, where markup-looking text is ordinary script or stylesheet content.

## Decision

Add a separate `html` profile, selected automatically for `.html` and `.htm` and available in the existing manual selector. Color complete tags, attribute names, quoted or unquoted attribute values, comments, declarations and text entities. Keep quoted attribute values opaque, including any entities inside them. Leave incomplete constructs uncolored.

Treat `script`, `style`, `noscript`, `textarea`, `title`, `xmp`, `iframe`, `noembed`, `noframes` and `plaintext` contents as opaque until their HTML end tag, so markup and entities inside them are not highlighted as page content. `noscript` stays opaque because its browser parsing depends on scripting mode, which this preview does not model. Keep source in the existing textarea/overlay path: never insert it as HTML, validate it as a document, or execute embedded code. Reuse the existing 64,000 UTF-16 code-unit and 4,096-token limits. Add no package, IPC, persistence or save behavior.

## Consequences

- Both local and SFTP editors get the same auto-detected and manually selectable preview.
- This is an ASCII-oriented lexical aid, not an HTML tokenizer/tree builder or validator. It does not highlight CSS/JavaScript inside raw-text elements, decode entities, handle every malformed-markup recovery rule, or style references inside attribute values.
- F-014/P-27 remain partial for broader language coverage and remaining editor acceptance.
