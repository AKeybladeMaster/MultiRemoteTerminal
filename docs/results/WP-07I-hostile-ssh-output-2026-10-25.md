# WP-07I — Hostile SSH terminal-output security acceptance

**Requirement:** N-002 renderer/terminal-output security evidence. This unpackaged-app test closes the specific hostile-output gap identified in the WP-07G N-002 audit; it does not complete N-002 or M4.

## Change

The loopback SSH fixture used by the standalone/contextual SFTP E2E sends a terminal line containing an HTML image with an `onerror` handler. If interpreted as markup and executed, the handler sets a renderer marker and attempts to call `require('node:fs').writeFileSync()` against a marker path inside the temporary app profile.

The E2E verifies the actual SSH output appears in xterm as text, the terminal host has no injected `img` node, the marker is not set, renderer `process` and `require` remain unavailable, and the marker file does not exist. The same test retains its trust, SFTP-only/no-shell, directory, editor and transfer assertions. A separate focused E2E continues to exercise inline-script and HTML injection, file/network fetch denial, popup/permission denial, and foreign-sender rejection.

## Validation

On Windows x64:

- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "hostile SSH output" --reporter=line` — passed, 1/1. The case exercised the SSH fixture, actual utility-worker transport, main broker, preload bridge and renderer terminal.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "CSP/Electron policy" --reporter=line` — passed, 1/1.

## Review

- Spec-axis review initially flagged an incorrect P-32/package label. The result now identifies only N-002 evidence from the unpackaged app, and the follow-up review approved the corrected status and links.
- Standards-axis review found no documented-standard violations or actionable code smells.

The test proves this bounded HTML event-handler payload is inert in the terminal path. It does not prove that every terminal-emulator CVE, escape-sequence dialect, or possible renderer exploit is absent. N-002 remains partial because the installer/portable artifacts are unsigned and broader IPC/security evidence and M4 acceptance remain open.
