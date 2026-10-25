# WP-06C — confirmed MultiExec acceptance

**Date:** 2026-10-25

**Requirements:** F-008, P-19
**Status:** Verified for the covered Windows workflows; macro-specific keyboard bindings and SSH/Telnet macro playback interoperability remain open for the wider WP-06 gate.

## Behavior delivered

Users can select two to 256 running local, SSH or Telnet terminals, review the exact one-line input and every destination, then explicitly confirm the send. Validation rejects control characters, Unicode line/paragraph separators and bidi formatting controls. The application runner limits fanout to four concurrent writes and reports each target separately. It never retries or substitutes a target. TIMEOUT and UNAVAILABLE write replies are marked uncertain because delivery may have happened. Cancellation prevents queued writes from starting and waits for writes already in flight. Keyboard focus moves to the accessible run status when sending starts and when it finishes. The app does not capture output or persist/log command text or target lists.

## Windows acceptance

The Playwright E2E coverage passed on Windows x64:

- Three local PowerShell terminals receive the reviewed line only after the final confirmation; output is verified in each selected tab.
- Three independent loopback SSH fixture servers use distinct host keys and ports. The test confirms exact preview, no input before approval, exactly one copy of the line at each host, all three per-target successes, and a distinct response marker from each host.

Focused application/domain unit tests cover exact one-line and target validation, confirmation before send, target failure isolation, no automatic retries, uncertain timeout delivery and cancellation of queued writes.

## Validation run

All commands completed successfully in the Windows x64 workspace:

| Command | Result |
|---|---|
| `corepack pnpm typecheck` | Passed |
| `corepack pnpm lint` | Passed, including import-boundary checks |
| `corepack pnpm test` | 270 passed, 0 failed |
| `corepack pnpm build` | Passed; Windows native addon and renderer built |
| `corepack pnpm exec playwright test --grep "MultiExec (reviews the exact line|sends the reviewed line)"` | 2 passed |
| `git diff --check` | Passed |

The build reports Vite's existing advisory that the renderer bundle exceeds 500 kB (702.00 kB minified); the build succeeds.

## Limits

The SSH fixtures prove the desktop UI-to-SSH terminal write path against independent loopback servers. They do not establish broad interoperability with public SSH servers or prove remote shell command completion; a successful terminal write only confirms that the provider accepted the input operation. WP-06D later verifies 100 definitions survive restart and each replays on a Windows PowerShell target. Macro-specific keyboard bindings and SSH/Telnet macro playback interoperability remain open, so this evidence does not close WP-06 as a whole.
