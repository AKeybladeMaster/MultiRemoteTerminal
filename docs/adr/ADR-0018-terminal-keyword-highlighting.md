# ADR-0018: Bounded terminal keyword highlighting

**Status:** Accepted for WP-01F, 2026-10-25

## Context

F-014 asks for a terminal keyword highlight toggle. P-30 describes syntax highlighting, but a terminal does not provide shell syntax tokens to the renderer: it provides a changing screen buffer containing arbitrary output, ANSI colors, Unicode and control effects. Coloring raw output strings before xterm parses them could corrupt escape sequences or change terminal behavior.

## Decision

- Add optional user-configured regular-expression keyword rules with a global enable switch. The setting is disabled by default, rules are local workbench preferences, and no terminal transcript or rule match is persisted.
- Match only text extracted from xterm's parsed normal buffer and visible rows. Stop cell extraction before assembling a line over 2,048 UTF-16 code units. Render matches using xterm marker/decorations as foreground overlays; do not modify input, output, ANSI sequences, or scrollback contents. Existing ANSI colors remain visible for nonmatching cells. Rebuild decorations after parsing, scrolling, buffer changes and terminal resize.
- Use pinned `re2js` 2.8.6 instead of JavaScript's backtracking `RegExp` engine. Validate patterns before persistence and matching, and bound rule count, pattern length, compiled program size, groups, line length, rows scanned, matches per line and matches per refresh. Empty and zero-width matches are ignored.
- Allow only this exact pure-JavaScript policy package as a domain dependency; the import-boundary checker continues to reject other external dependencies from domain, application and contracts.
- Keep the feature opt-in. Unsupported RE2 syntax and invalid or oversized patterns are rejected with a settings error. This is keyword coloring, not shell parsing, command grammar highlighting or a zsh theme.
- Advance the `workbench` preference schema from v1 to v2. A valid v1 greeting migrates to v2 with highlighting disabled and no rules; malformed or unsupported stored values fail closed as corrupt preferences.
- Permit inline styles in the application CSP because xterm.js inserts runtime `<style>` elements for parsed ANSI colors and decoration overlays. Keep scripts restricted to `'self'`; network connections, objects, frames, forms and other defaults remain denied. The E2E security test continues to prove inline script and network denial.

## Consequences

The screen may be rescanned after parsing, scrolling, buffer changes and resize, but work per refresh is bounded. Decorations are disposable transient renderer state and naturally disappear when the terminal buffer changes or the pane closes. The preference migration is local and does not touch the SQLite table schema. Inline style permission expands CSS injection capability within the renderer, so terminal output must remain text and never be promoted to HTML; the rule does not relax script execution or network access. A future stricter style policy would need to preserve xterm's runtime style mechanism and repeat the ANSI-color security E2E.

## Verification

See [WP-01F acceptance evidence](../results/WP-01F-terminal-highlights-2026-10-25.md) and [RE2JS dependency review](../dependencies/WP-01F-re2js.md).
