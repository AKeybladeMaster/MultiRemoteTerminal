# ADR-0042: Bounded YAML syntax profile

**Status:** Accepted for WP-08K, 2026-10-27

## Context

F-014/P-27 provide local and SFTP text editors with bounded, renderer-only syntax previews. YAML is common in configuration and deployment files. A full parser would add grammar, schema and validation behavior to an optional readability aid; the existing pure domain tokenizer can color common lexical forms without changing editor behavior.

The [YAML 1.2.2 specification](https://yaml.org/spec/1.2.2/) defines block and flow collections, quoted and plain scalars, comments, directives, document markers, tags, anchors/aliases and block scalars. Its recommended core schema describes common null, boolean, integer and floating-point plain-scalar forms. YAML 1.2.2 makes no normative language changes from YAML 1.2.

## Decision

- Add a `yaml` profile to the shared tokenizer. Auto detection recognizes `.yaml` and `.yml`; users may also select YAML manually.
- Color plain and quoted mapping keys; quoted/plain strings; YAML 1.2 core null, boolean and numeric forms; comments only when separated from preceding content; flow collection punctuation; document markers and `%YAML`/`%TAG` directives; tags; anchors; aliases; and block scalar headers and body text.
- Treat quoted and block scalars as opaque tokens so comment markers and syntax-like text inside them do not receive nested colors. Block scalar body indentation is detected with a bounded lexical approximation.
- Cap implicit-key colon lookahead at 1,024 UTF-16 code units on one line, following the YAML implicit-key lookahead limit. Keep the shared 64,000 UTF-16 code-unit and 4,096-token preview limits.
- Add no package. The renderer preview changes no file bytes and does not validate, parse, execute or persist source content.
- Treat core-schema scalar colors as visual hints, not resolved types or validation. YAML 1.1-specific words such as `yes` and `on` remain strings; timestamps and application-specific tags are not resolved.

## Consequences

Common YAML settings remain readable in both editors without changing source text. The scanner intentionally does not model indentation-sensitive grammar, folded plain scalar continuation, duplicate mapping keys, tag resolution or schema selection. Malformed input can receive colors that resemble valid tokens. Implicit-key lookahead counts UTF-16 code units, and block-scalar indentation is approximate; the profile is not a YAML parser or validator.

## Verification

See [WP-08K YAML syntax profile results](../results/WP-08K-yaml-syntax-profile-2026-10-27.md).
