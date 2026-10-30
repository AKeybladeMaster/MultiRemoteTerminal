# ADR-0059: Curated editor syntax profiles and bounded preview viewport

- **Status:** Accepted for WP-08S
- **Date:** 2026-10-30
- **Requirements:** F-014 / P-27

## Context

The shared local and SFTP editors already support bounded lexical profiles for common shell, source, markup and configuration formats. The feature documents did not name a finite language inventory, so “broader language coverage” could otherwise remain open indefinitely. The editor also resolved visible preview lines by rescanning from the beginning of the file on every scroll event.

## Decision

- Define the editor's auto-detected syntax profile set as a curated list: the existing Markdown, Shell, PowerShell, Python, JavaScript/TypeScript, SQL, TOML, YAML, INI, XML, HTML, dotenv, Java Properties and JSON profiles, plus C/C++/Java/C#-family and CSS profiles.
- Detect the C-family profile for `.c`, `.h`, `.cc`, `.cpp`, `.cxx`, `.hh`, `.hpp`, `.hxx`, `.java` and `.cs`; detect CSS for `.css`. Keep manual profile selection for both local and SFTP files. Unknown extensions remain fully editable as plain text.
- Treat every profile as a bounded visual aid, not a grammar, validator, renderer or executor. Keep source text on the existing textarea and preserve the 64,000 UTF-16 code-unit and 4,096-token bounds.
- Build a transient line-start index when the editor value changes, with checkpoints every 128 lines. Resolve each preview viewport from the nearest checkpoint so scrolling does not scan the whole file.
- Let the dialog itself scroll when its contents exceed the viewport. Reduce the editor surface's minimum height on short viewports so the actions remain reachable at high display scale.
- Add no parser, package, IPC command, persistence, logging or file-write behavior.

## Consequences

Common C-like source and standalone CSS files receive useful colors in both editors; embedded CSS inside HTML remains opaque. C-family and CSS tokenization is intentionally lexical and approximate. C++ raw strings, Java text blocks, and C# verbatim strings are kept opaque, but language-specific preprocessing, interpolation, selector grammar, nesting and dialect validation are not implemented. Unsupported languages still open and save as plain text.

The bounded checkpoint index adds small transient renderer state proportional to one checkpoint per 128 lines. It contains only offsets and is discarded with the current draft. A 200%-scale UI automation smoke does not replace physical Windows display, contrast or assistive-technology testing.

## Verification

See the [WP-08S and Phase 06 acceptance record](../results/PHASE-06-text-editor-gate-2026-10-30.md) after the implementation freeze.
