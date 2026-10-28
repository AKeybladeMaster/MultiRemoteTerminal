# ADR-0053: Bounded XML text syntax profile

- **Status:** Accepted
- **Date:** 2026-10-28
- **Requirement:** F-014 / P-27

## Context

The local and SFTP text editors share a renderer-only lexical preview. XML, schema, stylesheet and SVG files are common in remote administration, but parsing or rendering their contents would add complexity and could expose active document behavior.

## Decision

Add an `xml` profile to the existing pure-domain tokenizer. Auto-detect `.xml`, `.xsd`, `.xsl`, `.xslt` and `.svg`; allow manual selection for other text files. Color element names, markup delimiters, attribute names and quoted values, comments, CDATA, opaque processing instructions/declarations and text entity references. Reuse the existing 64,000 UTF-16 code-unit and 4,096-token bounds; cap each entity reference at 64 code units.

The scanner is ASCII-oriented for names, leaves incomplete constructs uncolored, and does not parse namespaces or declaration semantics. It never resolves entity references, renders SVG, validates or executes source text. No package, IPC command, persistence path or save behavior is added.

## Consequences

- Local and SFTP editing reuse the same accessible textarea, aria-hidden preview and theme token colors.
- XML-derived content remains plain text and is not interpreted by the app.
- Unicode XML names, dialect validation and full XML parsing are outside this lexical profile; F-014/P-27 remain partial.
