# Phase 03 — Remote protocols and routing gate (2026-10-30)

**Disposition: PARTIAL; no promotion to `main`.** This gate verifies a scoped packaged SSH credential-prompt slice and a direct-provider OpenSSH integration fixture. It does not complete the remote-protocol phase.

## Scope

- Requirements: F-003/P-03 SSH password authentication and host verification; scoped security evidence for N-002; F-019 Rlogin/RSH feasibility research only.
- Work packages: WP-02G packaged native SSH credential prompt, the direct-provider fixture in `tests/integration/openssh-ssh.test.ts`, and WP-09R research. Existing WP-02A/B/F and WP-04I evidence remains separately scoped in the feature matrix.
- Candidate was based on `dev-1` at `a3f6253904eeb8e00fa0f4af473f5912262c85ba`. The WP-02G implementation and its review fixes are `c4df599dbc4813249fe37b418722ec1ed71ce40b` and `5f0ff31cad626f31141e1ca257bbb20d0da26db8`; all three reviews covered `c4df599dbc4813249fe37b418722ec1ed71ce40b..5f0ff31cad626f31141e1ca257bbb20d0da26db8`.

## Environment

- Windows x64, Node.js 24.14.1, pnpm 12.15.0; `TEMP` and `TMP` pointed to `.tmp/phase03-final/temp`. The pinned Node archive was downloaded to ignored `.tmp/` from the official Node.js release and its SHA-256 matched the published release checksum.
- A disposable Debian 12 container ran OpenSSH `1:9.2p1-2+deb12u10`. The host port was dynamically assigned on `127.0.0.1`; a generated test password and test-only account were used. The container and image were removed after the final passing run.
- Package smoke emitted an unsigned Windows x64 NSIS installer and portable executable. No signing certificate was configured, so these are test artifacts, not release-qualified signed packages.

## Verification

- `git diff --check`, TypeScript/tools typecheck, ESLint/import-boundary checks, Windows x64 native/renderer build, unit suite and full Electron E2E suite passed through `pnpm check`.
- Full E2E result: **71 passed, 7 skipped, 0 failed**. One skip is the open Git Bash immediate-input-after-resize case from Phase 02; six package-only tests were exercised by the separate package run.
- `pnpm test:ssh-fixture`: **1 passed, 0 skipped, 0 failed** against the disposable loopback Debian/OpenSSH server. It verified terminal input/output, SFTP directory listing, host-key rejection and bad-password rejection through the SSH transport provider. This is provider interoperability evidence, not a packaged-app test.
- `pnpm package:win:smoke`: **6 passed, 0 failed**. It covered the installer and portable builds, offline/200% scale behavior, package metadata and hashes, and the packaged credential flow.
- WP-02G used the actual portable app with no `MRT_E2E` credential hook. The shipped Windows credential dialog received generated synthetic values over helper stdin, the test approved first-use host trust, and the SSH fixture returned a terminal marker. The test confirmed that the synthetic password was absent from renderer text and the app's saved-session SQLite database. The package fixture is `ssh2.Server`; it does not establish packaged OpenSSH interoperability or packaged SFTP.
- The first full E2E gate exposed a missing PowerShell brace in the new UI Automation helper. After correcting the helper, the complete `pnpm check` was rerun and passed. The first disposable-server setup also used a Windows PowerShell stdin pipeline that altered the fixture password; the final run used an LF-only temporary input file and passed. These were test-harness issues, not passing results.

## Independent reviews

- **Specification:** Pass. No Critical or Important findings. The reviewer asked to update this report's exact-commit and temp-path metadata; those metadata corrections are included here. The changed P-03 summary remains PARTIAL and keeps packaged SFTP, Windows OpenSSH agent interoperability, Mosh and real-server gaps open.
- **Standards:** Pass with no blocking findings. One Minor duplication observation noted that credential-dialog polling resembles other native-dialog waits; the separate UI Automation search and process scoping are distinct enough to keep the current code without extraction.
- **Implementation:** Pass with no findings. The reviewer verified the packaged smoke is the only caller, app PID availability, transitive descendant filtering, bounded wait/close polling, alphanumeric SendKeys validation and fixture cleanup.
- The review fixes scope prompt discovery to the launched app's process tree and constrain synthetic `SendKeys` input to alphanumeric characters. The stale P-03 overview was corrected in `docs/FEATURE-MATRIX.md`.

## Blockers and limits

- F-003/P-03 remain PARTIAL. The installed Windows OpenSSH agent service is stopped and disabled; it was not started or modified, and no real user credentials were used. Packaged SFTP, wider Windows OpenSSH agent interoperability and broader real-server acceptance remain open.
- No Mosh runtime or configured user WSL distribution was available for Mosh mobility acceptance. WP-09R is research only: no Rlogin/RSH provider or interoperability is claimed. These are Could parity features.
- No physical serial COM device was present, so physical device and unplug/reconnect acceptance remain open; mock serial evidence does not replace hardware.
- No authorized public FTP/FTPS server was available. Local fixtures do not establish public certificate-chain or broad server interoperability.
- The normal E2E suite still skips the Phase 02 Git Bash resize/input case. The package artifacts are unsigned and not release-qualified.
- The three review axes found no Critical or Important findings in the reviewed slice. These reviews do not close the listed external acceptance gaps, so Phase 03 remains PARTIAL and is not promoted to `main`.

## Follow-up

Continue with independent Phase 05 graphical-session work while the Phase 03 hardware, Windows-agent and external-server requirements remain open.
