# WP-01I: Shell command grammar coloring — acceptance evidence

**Date:** 2026-10-27
**Platform:** Windows 11 x64, Node.js 24.14.1, Electron 45.0.0
**Requirements:** P-30 and F-014 (partial)

## Delivered behavior

- The pure domain Shell tokenizer now distinguishes a fixed common Bash/Zsh builtin list from command-position words. Builtins receive a separate green color in both editor previews and transient terminal prompt decorations; external or unresolved command-position words keep the existing cyan color.
- The bounded scanner recognizes `[[`, `]]`, `!` and `time` markers and keeps command-position state through selected `sudo`, `doas`, `env`, `nice`, `nohup`, `command`, `builtin` and `exec` wrappers. It consumes the explicitly listed wrapper option arguments and colors environment assignments without losing the wrapped command position.
- The coloring remains opt-in. Terminal content is read from xterm's parsed normal buffer and is decorated in renderer memory; no command is probed or executed, no terminal bytes are changed, and command text is not persisted or logged. Existing 2,048-code-unit, 128-row and 64-decoration bounds remain in force.
- Windows E2E verifies builtin/external/wrapper colors at the Git Bash prompt, Shell builtin colors in the local editor, the SFTP editor profile and existing wrapped-input colors over loopback SSH and Telnet.

The fixed tokenizer does not inspect the active shell or PATH, resolve aliases/functions, parse heredocs or retain explicit continuation-line state. It is a bounded lexical aid; P-30/F-014 remain PARTIAL. No dependency was added. See [ADR-0044](../adr/ADR-0044-shell-command-grammar-coloring.md).

## Validation

- `corepack pnpm build` — passed on Windows x64. The renderer bundle is 999.08 kB minified / 274.16 kB gzip; Vite emitted its existing advisory for chunks over 500 kB.
- `corepack pnpm exec tsc -b --force` followed by `corepack pnpm typecheck` — passed. An initial typecheck overlapped with the clean build and encountered missing incremental declaration outputs; the forced project-reference rebuild restored them, after which the normal typecheck passed.
- `corepack pnpm lint` — passed, including static import-boundary checks.
- `node --test tests/unit/text-syntax.test.ts` — 32/32 passed, including `[[ ... ]]` test-expression state, wrapper assignment values and `time` command-position coverage.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "SFTP sessions verify trust and transfers|local text editor auto-detects SQL and supports TOML|Git Bash runs in a local terminal|shell prompt coloring works in SSH and Telnet" --reporter=line` — 4/4 Windows Electron E2Es passed in 1.4 minutes.
- `git diff --check` — passed.

## Review

Independent General, Spec and Standards review is recorded in [WP-01I review outcome](WP-01I-review.md).
