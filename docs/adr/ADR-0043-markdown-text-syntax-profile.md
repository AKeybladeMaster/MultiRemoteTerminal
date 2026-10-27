# ADR-0043: Bounded Markdown syntax profile

**Status:** Accepted for WP-08L, 2026-10-27

## Context

F-014/P-27 provide local and SFTP text editors with bounded, renderer-only syntax previews. Markdown files commonly mix headings, list structure, links and code samples. A full CommonMark parser or HTML renderer is unnecessary for a readability aid and would add substantial grammar and rendering behavior to the editor.

The [CommonMark 0.31.2 specification](https://spec.commonmark.org/0.31.2/) defines block and inline structure, fenced code blocks, code spans, emphasis, links, headings, thematic breaks, block quotes and list items.

## Decision

- Add a `markdown` profile to the shared pure-domain tokenizer. Auto detection recognizes `.md` and `.markdown`; users may also select Markdown manually.
- Color ATX heading markers, simple list and block-quote markers, thematic breaks, fenced-code delimiters and info strings, fenced code body text, same-line code spans, simple single/double emphasis, direct inline links and same-line HTML comments.
- Keep the existing 64,000 UTF-16 code-unit and 4,096-token preview limits. Bound inline link, code-span, emphasis and comment lookahead to 512 code units on one line and aggregate lookahead work to 256,000 probe steps per preview; exhaustion stops coloring and uses the existing truncation notice.
- Add no package. The preview remains text-only; it does not render HTML, change file bytes, persist, validate or execute source content.
- Treat this profile as a lexical readability aid, not a conforming CommonMark parser. It does not model nested block containers, setext headings, indented code blocks, reference links, multiline inline constructs or Markdown extensions such as tables and task lists.

## Consequences

Common README-style documents receive bounded colors in local and SFTP editors while the accessible textarea remains the editing surface. Malformed or extension-specific syntax may receive no color or an approximate color. The existing renderer overlay and shared token cap remain unchanged.

## Verification

See [WP-08L Markdown syntax profile results](../results/WP-08L-markdown-syntax-profile-2026-10-27.md).
