# Codex resume snapshot — 2026-10-29

Treat `docs/SPEC-001-MultiRemoteTerminal.md`, `docs/FEATURE-MATRIX.md`, `docs/IMPLEMENTATION-PLAN.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, the glossary and relevant ADRs as the requirements source of truth. Refresh Git state before editing.

## Git and workspace

- Repository: `AKeybladeMaster/MultiRemoteTerminal`; work branch: `dev-1`.
- Before this continuation, local `dev-1` and `origin/dev-1` were both `0012a8634c8498c2ac3b2fab2c86312630b04ba6`. Current verified refs were `origin/dev=222e15138a1b43476ff7fc2ffa7395b5c889e92d` and `origin/main=67812739ba521d57007e15faa24e0b5a09d56e06`.
- This continuation changes only `tests/e2e/foundation.test.ts` and this handoff document. Commit and push these reviewed files only to `dev-1`; do not write to `main`.
- Preserve the user-owned worktree changes: modified `AGENTS.md`, modified `pnpm-workspace.yaml`, and untracked `docs/agents/`. Do not stage them.
- Build/test output is ignored: `.tmp/`, `dist/`, `test-results/`, `playwright-report/`, `artifacts/` and `apps/desktop/native/build/`. Do not commit generated outputs or `session-context.md`.

## Current code slice

The editor syntax-preview row virtualization is committed as `0012a86`.

The current test-only maintenance change captures SSH fixture errors during credential-boundary assertions and suppresses expected socket errors after test teardown begins. The routed-tunnel trust loop now waits for an expected, not-yet-approved host port before reading the dialog; visibility alone could match the previous hop while its async approval was still completing. No production behavior changed. Independent standards and spec reviews found no concrete issue; their review scope was the test diff.

## Verification on this Windows x64 machine

- Node `24.14.1`, pnpm `12.15.0`.
- `corepack pnpm check`: passed typecheck, lint/import boundaries, 578 unit tests and Windows E2E (68 passed, five package-specific tests skipped by the general E2E command).
- Focused SSH route E2E with `--repeat-each=10`: 10 passed.
- `corepack pnpm package:win:smoke`: 5 package tests passed, including NSIS install/offline launch at 200% scale/uninstall, portable launch/data placement, and SSH log finalization on shutdown.
- The build warns that the minified renderer bundle is about 1,020 kB, above Vite's 500 kB advisory threshold.
- Current unsigned x64 outputs are in `artifacts/windows/`: `MultiRemoteTerminal Setup 0.0.0.exe`, `MultiRemoteTerminal 0.0.0.exe`, per-artifact CycloneDX SBOMs, and `SHA256SUMS.txt`. The generator reports 31 runtime components and `NotSigned` for both executables. The existing `win-packed.zip` is from 2026-10-28 and was not refreshed by the current package script.

## Release status and remaining acceptance

The app is **not release-ready**. M4 requires N-001 through N-007 and the security checklist still has open items. Current Windows loopback and packaged smoke results do not replace these acceptance checks:

- **P-03:** disposable OpenSSH interoperability, the real Windows OpenSSH agent service, and packaged native credential prompting.
- **P-14/P-15:** native Explorer drag-and-drop, sustained transfer throughput and broader server interoperability.
- **P-22..P-25:** public/non-loopback bind consent, SOCKS UDP/BIND/authentication, routes beyond three hops and broader interoperability.
- **P-28/P-29:** macro secret-prompt detection is heuristic; physical Windows session lock, cross-account restore, DPAPI migration and all credential-flow review remain open.
- **P-32:** signed/verified distribution and Windows 10 acceptance. Current artifacts are unsigned test builds.
- **P-37/P-42:** shell/tool install-update-remove lifecycle and the planned enhanced security policy settings.
- Security release gate: all-flow secret exclusion review, dependency/license audit, and publication of the generated SBOM and installer hashes remain open. The security checklist also tracks broader privilege-injection and daemon/X11 policy acceptance.
- `F-014` remains PARTIAL: broader syntax profiles and full shell grammar are open. Other non-MVP/parity gaps remain in the feature matrix; do not describe the product as full parity.

Use loopback fixtures only for SSH E2E. The confidential company endpoint from the user's report must not be repeated or contacted from this workspace.

## Next steps

1. Refresh remote refs and verify `git branch --show-current`, `git rev-parse HEAD`, and `git ls-remote --heads origin dev-1 main`; keep work on `dev-1` only.
2. Confirm the reviewed test/resume changes are present on `origin/dev-1`; preserve the three user-owned changes above and keep ignored build output untracked.
3. Continue the remaining MVP implementation/acceptance items with one complete, tested and reviewed slice at a time. Re-run `corepack pnpm check` and `corepack pnpm package:win:smoke` after relevant code changes.
4. Keep M4 blocked until each required acceptance item is evidenced, security review has no unresolved critical/high findings, and the signing/release decision is verified. Do not modify or merge into `main`.
