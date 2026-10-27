# ADR-0039: Bounded JavaScript and TypeScript syntax profile for text editing

**Status:** Accepted for WP-08H, 2026-10-27

## Context

F-014/P-27 now provide shared renderer-only Shell, PowerShell, Python and JSON previews in local and SFTP text editors. JavaScript and TypeScript files are common sources opened in a text editor. A full parser would add dependency and grammar-maintenance cost to an optional visual aid; the shared pure tokenizer and existing preview limits can recognize common lexical forms without changing the editor architecture.

The [ECMAScript 2025 lexical grammar](https://tc39.es/ecma262/2025/multipage/ecmascript-language-lexical-grammar.html) defines comments, string literals, numeric literals, punctuators and identifiers. The [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html) documents type annotations and common types such as `string`, `number` and `boolean`.

## Decision

- Extend the shared pure domain tokenizer with a `javascript` profile. Auto detection recognizes `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts` and `.cts`; users may select the profile manually for other text files.
- Color common JavaScript/TypeScript keywords, function and type declaration names, TypeScript type keywords, common global values, quoted and template strings, line/block comments, numeric literals and operators.
- Reuse existing semantic theme colors, the accessible textarea and aria-hidden preview overlay, and the 64,000 UTF-16 code-unit/4,096-token bounds. Add no dependency; do not execute, validate, persist or modify source content.
- Keep the profile lexical, not a parser. Template strings remain one opaque token, regular-expression literals are not recognized, JSX markup is not parsed, and identifier recognition is ASCII-oriented.

## Consequences

Common JavaScript and TypeScript constructs receive readable colors in both editors without changing saved bytes. Context-sensitive slash interpretation, JSX structure, nested template interpolation, Unicode identifier rules and the full TypeScript grammar remain outside this profile. Broader language support and autosave remain open under F-014/P-27.

## Verification

See [WP-08H JavaScript/TypeScript syntax profile results](../results/WP-08H-javascript-typescript-syntax-profile-2026-10-27.md).
