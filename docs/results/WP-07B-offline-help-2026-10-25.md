# WP-07B — Offline help and keyboard reference

**Date:** 2026-10-25

**Requirement:** P-33, offline manual and keyboard reference.

**Branch:** `dev-1`

## Delivered

- Added a local searchable Help dialog reachable from the workbench header and
  the command palette. It uses renderer-only content; it adds no IPC, network
  calls, packages, or privileged capabilities.
- Covered current connection types, saved sessions and folder bundles, keyboard
  shortcuts, terminal actions, transfers, SSH gateways and forwarding, macros,
  MultiExec, themes, security notes, and troubleshooting.
- Added [the repository user guide](../USER-GUIDE.md) as an offline Markdown
  manual. The in-app guide and repository guide both explain that exported
  bundles are not encrypted and contain connection metadata but no credentials,
  private keys, or terminal history.
- Added keyboard dismissal and focus trapping, initial search focus, focus
  restoration, a no-results message, and one-column article layout at the
  workbench's existing narrow breakpoint. The scrollable article region is
  keyboard-focusable. The help follows the existing light and dark theme tokens.

## Verification

On Windows x64, current working tree:

- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed; import boundaries passed.
- `corepack pnpm build` — passed. Vite reported the existing large renderer
  chunk advisory (719.64 kB minified); there were no build errors.
- `corepack pnpm exec playwright test -g "offline help opens" --reporter=list`
  — 1 passed. It exercised header and command-palette entry points, all shortcut
  rows, keyboard scrolling, filtering, focus cycling and restoration, Escape
  dismissal from both entry points, light theme, and a narrow window with a
  single article column and no horizontal overflow.
- `git diff --check` — passed.

Screenshots were captured at the default test window size and after resizing the
window to 620 × 760: dark, light and narrow layouts. They are local Playwright
artifacts and are not committed.

## Limits

This verifies the help flow on the current Windows x64 test host. It is not a
screen-reader certification, physical touch-device test, or completion of the
separate MVP installer, security, and compatibility release gates. P-32 and the
M4 release gate remain open.

Review passes found omitted shortcut aliases and menu actions, ambiguous FTP
warning frequency, an inaccessible scroll region, a focus handoff issue from the
command palette, missing instructions for reopening saved sessions, and an
ambiguous privacy sentence. These findings were corrected. The focused Windows
E2E covers keyboard scrolling, all 13 shortcut rows, and focus behavior for both
help entry points.
