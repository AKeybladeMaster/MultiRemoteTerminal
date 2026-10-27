# WP-08F PowerShell editor syntax profile results

**Date:** 2026-10-27

**Requirements:** F-014, P-27 (partial)

## Delivered

- Added a pure domain `powershell` syntax profile and automatic detection for `.ps1`, `.psm1`, `.psd1` and `.pssc` files.
- Added lexical colors for common command-position words, keywords, parameters, comparison/logical operators, variables, quoted strings, here-strings, line/block comments, numbers and simple type literals.
- Added the PowerShell selector and extension guidance to the shared local/SFTP editor. Existing semantic theme colors, accessible textarea, aria-hidden preview overlay and scan bounds remain in use.
- Added no package. Preview rendering does not validate or execute source, change saved bytes, persist content, or send file contents over a new channel.
- Updated the architecture, security, specification, feature matrix, implementation plan, ADR and user guide. P-27/F-014 remain PARTIAL for broader language support and autosave.

## Verification

- `node --test tests/unit/text-syntax.test.ts` — passed, 8/8.
- `corepack pnpm build` — passed on Windows x64. Vite reports the existing advisory that the 972.50 kB minified renderer chunk exceeds 500 kB.
- `corepack pnpm lint` — passed, including static import-boundary checks.
- `corepack pnpm typecheck` — passed after a forced TypeScript project-reference rebuild. The first run observed missing declaration outputs with `TS6305`; verbose build output showed the domain project incorrectly considered up to date while those outputs were absent. `corepack pnpm exec tsc -b --force --verbose` regenerated project outputs, after which the normal typecheck passed.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "local text editor auto-detects PowerShell|SFTP sessions verify trust"` — passed, 2/2. Covers local auto/manual profiles, theme colors, Shell/JSON profiles, remote SFTP PowerShell auto-detection and existing SFTP editor behavior.
- `git diff --check` — passed.

## Limits

This is a bounded lexical aid rather than a PowerShell parser. Command-position and type recognition are heuristics; full grammar, diagnostics, Unicode identifier coverage and nested interpolation coloring are outside this slice. The preview remains limited to 64,000 UTF-16 code units or 4,096 colored tokens. Native picker UI automation, editor autosave and other language profiles remain open.

See [ADR-0037](../adr/ADR-0037-powershell-text-syntax-profile.md) and [ADR-0023](../adr/ADR-0023-text-syntax-profiles.md).
