# WP-01F: Terminal keyword highlighting — acceptance evidence

**Date:** 2026-10-25  
**Platform:** Windows 11 x64, Node.js 24.14.1, pinned workspace toolchain  
**Requirements:** F-014 keyword highlight toggle; P-30 terminal highlighting (partial)

## Delivered behavior

- Workbench settings provide an opt-in toggle and bounded color rules. Preferences survive app restart; schema-v1 greeting settings migrate to schema v2.
- Rules match parsed, visible xterm text and use disposable cell decorations. Matching text is colored without rewriting terminal input/output or ANSI sequences. Independent ANSI foreground colors remain visible.
- Matching uses pinned `re2js@2.8.6` with limits for rule count, pattern length, regex program size, capture groups, line size, visible rows and match count.
- CSP allows the inline styles xterm needs for runtime ANSI and decoration CSS. Inline scripts remain blocked and network connections remain denied.

This implements keyword coloring and the requested readability improvement. Full shell syntax parsing, shell-specific zsh grammar and local/remote file editor color profiles remain open, so P-30/F-014 are PARTIAL.

## Validation

- `corepack pnpm typecheck` — passed.
- `node --test tests/unit/assets.test.ts tests/unit/terminal-highlights.test.ts tests/unit/workbench-preferences.test.ts tests/unit/sqlite-workbench-preferences.test.ts tests/unit/bridge.test.ts tests/unit/broker.test.ts` — 69/69 passed.
- `corepack pnpm lint` — passed, including static import-boundary checks.
- `corepack pnpm build` — passed on Windows x64. The Vite renderer bundle is 893.24 kB uncompressed / 244.62 kB gzip and triggers the 500 kB advisory warning.
- Focused Windows Electron E2E: `terminal keyword highlighting` and `100% scale themes render and CSP` — 2/2 passed. The first verifies settings/rules across restart and cyan highlights while preserving independent ANSI-red output; the second confirms inline script and network sources stay blocked.
- Generated E2E settings screenshot visually reviewed for layout, legibility, color selection and focus indicator.
- `corepack pnpm audit --prod` — no known vulnerabilities found.
- `git diff --check` — passed after implementation and documentation updates.

## Limits and follow-up

Regex safety comes from RE2JS plus application work bounds; it is not a separate security audit of the JavaScript port. Inline CSS broadens style injection capability inside the renderer, so terminal text must stay text and the existing script/network CSP E2E remains a release guard. Syntax-aware shell parsing and high-DPI automated coverage remain open.

See [ADR-0018](../adr/ADR-0018-terminal-keyword-highlighting.md) and the [re2js dependency review](../dependencies/WP-01F-re2js.md).
