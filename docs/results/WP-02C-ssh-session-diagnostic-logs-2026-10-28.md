# WP-02C: SSH session diagnostic logging

**Date:** 2026-10-28
**Requirements:** F-027 and P-45
**Status:** Verified for F-027/P-45 on Windows (2026-10-28).

## Delivered

SSH terminal sessions can opt into a per-attempt local `.log` before connecting. Main owns the Save dialog path and asynchronous bounded JSONL writer. Records include ordered lifecycle, host-trust and credential-prompt categories, transport status, terminal input/output and resize/close events. Initial transport failures may include a normalized allowlisted network category; raw socket error codes and messages stay out of the log. Credential prompt contents and key bytes are excluded; the UI warns that terminal text and endpoint details can be sensitive.

## Windows validation

- `corepack pnpm typecheck`, `corepack pnpm lint` and `git diff --check` passed.
- Final focused broker, teardown-owner and log-writer unit tests passed: 50/50. They cover renderer loss before open, during key selection and transport startup, cancellation preventing SSH open, selected-key wiping, bounded I/O deadlines, caps and redaction.
- The latest complete unit suite passed: 567/567. Focused tests cover socket-error mapping, strict worker-reply validation, worker-host propagation, safe application activity and JSONL output.
- The final-tree Windows loopback E2E passed 1/1. It verifies the default-off checkbox resets for each attempt, a refused connection is finalized with its observed transport failure phase, a live session logs input and echoed output, credential values and the local profile path are absent, and closing the app flushes a final record.
- Native-dialog Windows E2E passed 1/1. It verifies consent cancellation and Save-picker cancellation create no log and do not invoke SSH credentials, then selects a `.log` under workspace `.tmp` and verifies the refused loopback attempt is logged and finalized without test credentials or the local profile path.
- Portable Windows x64 package E2E passed 1/1 against a fresh `package:win` build. It selects a workspace-local log through the native dialogs, verifies the opted-in log remains active, closes and waits for the actual Electron browser process and portable launcher to exit, then verifies the final record is `application-shutdown`.
- The full Windows E2E run reported 46 passed, 17 failed and 4 package-smoke cases skipped because artifacts were not built at the time. The SSH session-log E2E passed. Failures occurred in other editor, worker, routing, tunnel, serial, macro, storage, terminal and TFTP flows; they were not established as pre-existing.
- `corepack pnpm package:win` built the Windows x64 NSIS installer and portable executable with per-artifact CycloneDX SBOMs and a SHA-256 manifest. Package smoke passed 3/3: ASAR/fuse validation, SBOM/hash verification, and portable launch with PowerShell and Bash terminals.
- The build is unsigned because no signing certificate is configured. The NSIS smoke completed install, offline launch at 200% scale, persistence, ASAR-tamper rejection and uninstall. Its install/profile paths were under workspace .tmp via the test process TEMP/TMP overrides.
- `corepack pnpm build` passed under pinned Node 24.14.1 and pnpm 12.15.0; Vite emitted its existing bundle-size advisory above 500 kB.
- Window close now starts the bounded logger flush before renderer teardown, and normal renderer-loss cleanup does not close SSH sessions during app shutdown; `before-quit` also closes any remaining log before disposing SSH sessions.
- Final slice checks: `corepack pnpm typecheck`, `corepack pnpm lint`, PowerShell syntax parsing and `git diff --check` passed; focused session-log writer/owner unit tests passed 7/7; both source session-log E2Es passed 2/2; the portable packaged-app acceptance passed 1/1.

## Remaining acceptance

P-45 is VERIFIED for the specified per-session logging flow. The packaged checks cover portable Windows x64 shutdown and NSIS install/offline-launch/uninstall acceptance, with the NSIS install/profile paths under workspace .tmp. This evidence uses loopback fixtures and does not verify any external SSH server, VPN route, or real-network interoperability.

## Review follow-up

- Added simulated `ENOSPC` coverage through the SSH activity subscription and diagnostic writer. The writer reports `stopped/write-error`; the active controller continues delivering output and accepts input without closing the session.
- Added utility-worker exit coverage for sanitized SSH session failure events and controller transport-failure activity. The logger's failed-attempt test also asserts the final `finished/connection-failed` status.
- The writer unit tests now place temporary files under workspace `.tmp`; no test scratch is written to the OS temp directory.
- Follow-up focused validation: `node --test tests/unit/ssh-session-log-writer.test.ts tests/unit/ssh-terminals.test.ts tests/unit/ssh-terminal-worker-host.test.ts` passed 37/37 on the final source. This focused unit run did not exercise the renderer status toast or NSIS installation.
- Fresh packaging with isolated Node 24.14.1 passed and generated unsigned Windows x64 NSIS/portable artifacts plus per-artifact SBOMs for 31 runtime components. The first attempt on system Node 24.14.0 correctly stopped at the repository's pinned-version gate; the exact Node archive was verified against the official SHA-256 and extracted under `.tmp` for the successful run.
- Fresh source SSH-log E2Es passed 2/2. In the package smoke run, the artifact/fuse and SBOM/hash tests passed 2/2, then the workspace-local NSIS install/offline-launch/uninstall test passed 1/1. The combined runner was stopped after that case; the remaining portable-terminal and portable-SSH-log-shutdown cases were run separately and passed 1/1 each.
- Consolidated all P-45 E2E scratch roots under the workspace `.tmp` directory. The final NSIS install/offline-launch/persistence/tamper/uninstall case passed 1/1 after this change; install, profile and tamper paths are now workspace-local by default.
- Final independent reviews: Spec found no mismatch or acceptance gap; Standards confirmed the workspace-temp fix and found no remaining issue. Reviewers inspected the candidate; they did not rerun tests. Final typecheck and lint passed, along with the focused NSIS rerun and `git diff --check`.
