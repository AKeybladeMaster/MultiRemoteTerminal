# WP-01K: PowerShell terminal prompt coloring — acceptance evidence

**Date:** 2026-10-27

**Platform:** Windows x64, Node.js 24.14.1, Electron 45.0.0

**Requirement:** P-30 (partial)

## Delivered behavior

- The existing opt-in terminal input-color preference now recognizes the common PowerShell `PS <path>>` prompt and dispatches active input to the bounded PowerShell tokenizer already shared with local and SFTP text editors.
- PowerShell commands, keywords, parameters, strings, variables, comments, operators, numbers and simple types use the existing terminal theme roles. Input remains normal terminal input; highlighting reads xterm's parsed normal buffer only after explicit typing and adds transient decorations.
- The renderer applies the existing 2,048-code-unit, 128-row and 64-decoration bounds. It stores no submitted command text for coloring and adds no IPC, shell probing, command resolution, validation, execution, persistence or dependency. PowerShell continuation prompts such as `>>` and custom prompt functions are not interpreted; serial remains excluded.
- The Windows PowerShell E2E verifies command, parameter and variable colors at a real local prompt and verifies Ctrl+C clears the decorations.

This is bounded lexical coloring, not PowerShell parsing or syntax validation. Prompt detection is heuristic and recognizes only the common `PS <path>>` form. P-30 remains PARTIAL; broader prompt forms, continuation syntax, Shell grammar and interoperability remain open. See [ADR-0046](../adr/ADR-0046-powershell-terminal-prompt-coloring.md).

## Diagnosis captured during acceptance

The first E2E attempts typed immediately after the session showed “running.” The Shell syntax preference was enabled, but instrumentation showed xterm's prompt buffer was still empty, so no input anchor could be established. The acceptance test now waits for the visible `PS …>` prompt before typing. The same focused test then passed, and all temporary diagnostic instrumentation was removed before final validation.

## Validation

- `node --test tests/unit/terminal-highlights.test.ts tests/unit/text-syntax.test.ts` — 46/46 passed.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including static import-boundary checks.
- `corepack pnpm build` — passed. Vite reported the existing large renderer-chunk advisory (1,001.85 kB minified / 274.95 kB gzip).
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "PowerShell prompt coloring" --reporter=line` — 1/1 Windows Electron E2E passed.
- `git diff --check` — passed.

Independent General, Spec and Standards review is required before promotion; its outcome will be recorded separately.
