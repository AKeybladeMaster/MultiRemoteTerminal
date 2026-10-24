# WP-01D: Terminal tab interactions and ANSI readability

**Requirements:** P-01; N-006; partial progress toward P-30 (palette only).
**Platform:** Windows 11 x64, Node 24.14.1, Electron 45.0.0.
**Status:** The behavior in this slice passed focused Windows Electron E2E; it does not complete M1/M4 or the application release.

## Delivered behavior

- `Ctrl+W` and middle-click on a terminal tab request closure through the existing confirmation dialog, so shell processes are not stopped without an explicit confirmation.
- Right-clicking a terminal tab opens an accessible, viewport-positioned action menu for copying selected output, clearing the displayed buffer, or closing the terminal. Saved-session rows do not open this terminal menu.
- Tab, Escape and window resizing close the menu and return focus to its terminal tab.
- The saved-session total appears as a separate labeled count badge next to the heading and remains the full catalog total while search filters visible entries.
- Clipboard writes are permitted only for the trusted app's main frame and only for the sanitized write permission; clipboard reads and all other permissions remain denied.
- Dark and light terminal themes use ANSI color values with at least 4.5:1 contrast against their terminal background. Shell and remote ANSI output remains responsible for its own coloring; command syntax parsing/highlighting is not included.
- Saved sessions remain in the per-user SQLite catalog across application exit and restart. There is no separate account login/logout feature in the current product.

## Validation

- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including import-boundary checks.
- `corepack pnpm exec node --test tests/unit/terminal-theme.test.ts` — passed, 1 palette contrast test.
- `corepack pnpm test` — passed, 84 unit and adapter tests.
- `corepack pnpm build` — passed on Windows x64; Vite reported the existing renderer chunk size advisory.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts -g "terminal tabs close|saved-session folders create"` — passed, 2 Windows Electron E2E tests, covering clipboard text, Tab/resize menu dismissal and focus, the full count during filtered search, clear action, Ctrl+W, middle-click and closure confirmation.
- `corepack pnpm check` — passed end-to-end after the count, clipboard and Tab-focus review fixes: typecheck, lint/import boundaries, all 84 unit and adapter tests, Windows x64 build and all 10 Electron E2E tests (including clipboard verification, ten-terminal ConPTY and 200% scale checks).
- After the later resize/Escape focus refinements, `corepack pnpm typecheck`, `corepack pnpm build` and the focused terminal-tab E2E passed again; the final test run covered Tab, Escape and resize focus restoration.

## Limitations

P-30 remains planned: the app does not yet apply configurable command/syntax rules to terminal input or output. This phase adds a more legible ANSI palette only. Package dependencies did not change. Saved session definitions remain local to the current Windows user profile and are separate from credentials.
