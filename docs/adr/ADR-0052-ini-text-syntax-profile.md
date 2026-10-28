# ADR-0052: INI-style text syntax profile

**Status:** Accepted for WP-08M, 2026-10-28

## Context

F-014/P-27 provide bounded syntax previews for local and SFTP text editing. INI-style files are common application and service configuration. A complete parser would add dialect-specific validation behavior to an optional readability feature; the existing pure domain tokenizer can color a small lexical subset without changing file behavior.

## Decision

- Auto-detect `.ini` and `.cfg`; keep the profile manually selectable for either editor.
- Color section headers, trimmed key names, `=`/`:` separators, closed single- or double-quoted values, whole-value decimal/exponent numbers, common true/false/yes/no/on/off values, and full-line `;`/`#` comments.
- Recognize backslash escapes while scanning quoted values. Use the shared 64,000 UTF-16 code-unit and 4,096-token preview limits.
- Keep coloring in the existing pure domain tokenizer and reuse the shared accessible textarea and aria-hidden preview. Add no dependency or file/IPC behavior.
- Treat colors as visual hints. Do not parse or validate INI, modify source bytes, evaluate values or persist preview state.

## Consequences and limits

The subset does not color inline comments, quoted keys, multiline/continued values or dialect-specific constructs. Numeric classification accepts decimal and exponent forms without digit separators. `.cfg` auto-detection is a filename heuristic; the extension alone does not guarantee INI content. F-014/P-27 remain partial for broader language coverage and autosave.

## Verification

See [WP-08M INI syntax profile results](../results/WP-08M-ini-syntax-profile-2026-10-28.md) for domain, local editor and SFTP acceptance evidence.
