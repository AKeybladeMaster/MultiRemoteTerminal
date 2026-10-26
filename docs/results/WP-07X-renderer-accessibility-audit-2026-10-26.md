# WP-07X — Renderer accessibility and copy audit

**Requirements:** N-006; partial progress toward the M4 UI accessibility audit.
**Platform:** Windows 11 Pro x64, OS build 10.0.26200.0.
**Status:** Static renderer review and focused keyboard/UI acceptance passed. N-006 and M4 remain partial pending physical 200% Windows DPI, assistive-technology, Windows 10 and other release acceptance.

## Scope and method

Reviewed the 26 renderer source files in `apps/desktop/src/renderer` against the current [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md), fetched on 2026-10-26. The review checked semantic controls, form labels, icon names, focus styles, live updates, keyboard paths, empty/long-list behavior, theme handling, reduced-motion needs and UI copy. No axe or JSX accessibility package is installed, and none was added.

## Changes

- Replaced ASCII three-dot loading copy with the single ellipsis glyph in terminal-opening, cancellation, save and FTP connection states.
- Standardized host and command example placeholders to end with an ellipsis glyph and show a usable example.
- The macro library E2E exposed an ambiguous accessible-name query: both the macro row and its “Set shortcut” button matched “Deploy checklist.” The test now scopes row assertions to `.macro-list-item`; no macro UI behavior changed.
- `TerminalPane` intentionally prevents the raw browser paste event and forwards the user's Ctrl+V action through the trusted main-process clipboard broker. This keeps clipboard access out of the renderer while preserving paste behavior.

## Existing accessibility evidence confirmed

- The workbench has a semantic main landmark, a skip link, a top-level heading, associated labels, semantic buttons, accessible names for icon-only actions, and alternative text for the decorative logo.
- Focus styles are present through the global `:focus-visible` rule and component-specific focus selectors. Dialogs expose keyboard close/focus behavior and constrain their scrolling. Async status and transfer updates use status/live-region semantics.
- Saved-session lists are virtualized at scale. No CSS transition or animation was found, so reduced-motion handling is not applicable to this renderer pass.
- Windows E2E covers the help dialog's keyboard filtering, Escape dismissal and focus restoration; macro editing and persistence also pass. WP-07E separately records the packaged 2× device-scale smoke.

## Validation

- `corepack pnpm build` — passed on Windows x64; Vite emitted the existing renderer chunk-size advisory.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including import-boundary checks.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "offline help opens from the workbench and command palette, filters topics, and restores focus" --workers=1 --reporter=list` — 1 passed.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "macro library creates, edits, persists and deletes typed steps" --workers=1 --reporter=list` — 1 passed after narrowing the ambiguous test locator.
- `git diff --check` — passed.

This is a renderer source review, not a WCAG conformance claim or screen-reader certification. Physical Windows display scaling, NVDA/JAWS use, high-contrast mode and Windows 10 remain separate acceptance work; N-006 stays partial.
