# ADR-0055: Bounded environment-file text syntax profile

- **Status:** Accepted
- **Date:** 2026-10-28
- **Requirement:** F-014 / P-27

## Context

Environment files are common in remote application and service configuration. The existing local and SFTP editors provide bounded, renderer-only lexical profiles, so a small environment-file view can reuse the shared preview without adding a parser or executing configuration values.

## Decision

Add a `dotenv` profile to the shared pure-domain tokenizer. Auto-detect `.env`, `.env.*` and `*.env` basenames case-insensitively; allow manual selection for other text files. Color ASCII environment keys in common `KEY=value` assignments, optional `export`, assignment separators, closed single- or double-quoted values, unquoted values, full-line comments and inline comments preceded by whitespace.

Reuse the 64,000 UTF-16 code-unit and 4,096-token limits. If the preview code-unit bound cuts through a line, leave that line uncolored. The profile is a visual aid only: it does not expand variables, interpret escapes, validate a dialect or execute content. Multiline values and line continuations are unsupported. No package, IPC command, persistence or save behavior is added.

## Consequences

- Local and SFTP editors share the existing accessible textarea and aria-hidden token overlay.
- Source bytes remain unchanged by preview rendering.
- F-014/P-27 remain partial for broader profile support and full editor acceptance.
