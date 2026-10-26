# WP-08E: Text editor syntax color profiles

## Requirement coverage

- F-014/P-27: adds shared Auto, Plain text, Shell script and JSON previews to the local and remote text editors.
- F-014/P-27 remain PARTIAL for broader language coverage and optional autosave. P-30 remains PARTIAL for full terminal shell grammar and zsh shell integration.

## Behavior

- Auto detects `.sh`, `.bash`, `.zsh`, `.ksh` and `.json`; the user can override a profile for the current file.
- Shell previews color command-position tokens, shell keywords, options, strings, variables, comments, operators and paths. JSON previews color keys, strings, numbers, literals and punctuation.
- The textarea remains the sole editing control. The aria-hidden preview follows both scroll axes, and file bytes change only after the existing explicit Save action.
- Each preview handles at most 64,000 UTF-16 code units and 4,096 tokens. The rest remains visible as plain editable text, with an explanatory note when the bound is reached.
- Preview colors follow the existing dark/light workbench theme. No dependency was added.

## Architecture

- Renderer textarea -> shared `TextEditorContent` -> pure `text-syntax` tokenizer from the domain package.
- The tokenizer receives only content already returned through the existing local-file handle or SFTP editor command. It has no filesystem, shell, IPC or React imports.
- Decision: [ADR-0023](../adr/ADR-0023-text-syntax-profiles.md).

## Validation

- `node --test tests/unit/text-syntax.test.ts`: **4 passed, 0 failed**.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm lint`: passed, including import-boundary checks.
- `corepack pnpm build`: passed on Windows x64; the renderer bundle is 924.95 kB minified and Vite reports its >500 kB advisory.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "local text editor auto-detects shell syntax" --reporter=line`: **1 passed**. It uses the guarded selected-path test hook and covers `.zsh` auto-detection, Shell and JSON token colors, switching to Plain text, unchanged file bytes before save, and scroll synchronization.
- Screenshot `test-results/editor-shell-syntax.png` (1164 x 761 pixels) was visually inspected in Playwright Electron. The existing editor dialog is the visual baseline; the token overlay aligns with the textarea and the dark palette remains readable.
- `git diff --check`: pending final review pass.

## Limits

- Shell coloring is lexical; it does not validate shell syntax, distinguish every quoting/expansion case, confirm that a command exists, or execute anything.
- JSON colors are not a JSON validator. Errors are not underlined or blocked.
- Syntax coloring stops at the documented preview bounds; the complete file remains editable and the explicit save path is unchanged.
- Native picker UI selection/dismissal remains unautomated as recorded in WP-08D.

## Review

Independent Standards and Spec review is pending.
