# WP-06E — Macro keyboard shortcuts

**Date:** 2026-10-25
**Requirement:** F-007 / P-28 (partial)
**Status:** Verified for the behaviors below; the broader macro requirement remains partial.

## Behavior verified

- Each saved macro can have one persistent, app-wide shortcut. A shortcut can belong to only one macro.
- Supported physical keys are A–Z, 0–9, numpad 0–9 and F1–F12, with Ctrl+Alt+Shift. AltGraph, Meta, repeat and composing events are rejected.
- A shortcut opens the selected macro's exact review for the current active terminal. Playback begins only after the user explicitly selects **Run macro**.
- Assignment survives application restart. Deleting a macro cascades its shortcut; changing an occupied shortcut reports a conflict.
- SQLite schema v3 adds a `macro_shortcuts` table without reusing `macro_bindings`, which remains reserved for target presets.

## Evidence

- `corepack pnpm build` — passed on Windows x64. Electron native addon and renderer/main bundles built successfully. Vite emitted a large renderer chunk advisory; the build still passed.
- `corepack pnpm exec playwright test --grep "macro shortcuts persist and open exact review"` — **1 passed** on Windows in 6.8 seconds. The test assigns F2, restarts the app, opens two PowerShell terminals, makes the second terminal active, and verifies the shortcut review targets that active terminal. It confirms the marker file is absent before approval, then verifies a single marker after Run.
- Focused unit run: `node --test tests/unit/macro-shortcuts.test.ts tests/unit/sqlite-macro-catalog.test.ts tests/unit/macros.test.ts tests/unit/macro-storage-protocol.test.ts tests/unit/contracts.test.ts tests/unit/bridge.test.ts tests/unit/broker.test.ts` — **72/72 passed**.
- `corepack pnpm typecheck` — passed.

## Remaining acceptance

F-007/P-28 remain partial. Secret-prompt detection is heuristic; SSH/Telnet macro playback interoperability has no Windows E2E evidence. Shortcut behavior is verified with a local PowerShell terminal.