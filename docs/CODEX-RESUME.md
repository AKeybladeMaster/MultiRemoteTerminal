# Codex resume snapshot — 2026-10-29

Treat `docs/SPEC-001-MultiRemoteTerminal.md`, `docs/FEATURE-MATRIX.md`, `docs/IMPLEMENTATION-PLAN.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, the glossary and relevant ADRs as the requirements source of truth. Refresh Git state before editing.

## Git and workspace

- Repository: `AKeybladeMaster/MultiRemoteTerminal`; work branch: `dev-1`.
- P-42 Settings policy summary is committed as `d594453 feat(settings): explain connection security policy`; host-key rotation acceptance is `5532fa8 test(security): verify SSH host-key rotation flow`; native picker test stabilization is `e99584d test(e2e): stabilize native file picker selection`. All three were pushed and verified on `origin/dev-1`. At the last remote check, `origin/dev=222e15138a1b43476ff7fc2ffa7395b5c889e92d`, `origin/dev-1=e99584d371d02ddc715db422e122a9ecf75c782a`, and `origin/main=67812739ba521d57007e15faa24e0b5a09d56e06`; `dev` and `main` were not changed.
- Preserve the user-owned worktree changes: modified `AGENTS.md`, modified `pnpm-workspace.yaml`, and untracked `docs/agents/`. Do not stage them.
- Build/test output is ignored: `.tmp/`, `dist/`, `test-results/`, `playwright-report/`, `artifacts/` and `apps/desktop/native/build/`. Do not commit generated outputs or `session-context.md`.

## Current code slice

The editor syntax-preview row virtualization is committed as `0012a86`.

Commit `32b1877` captures SSH fixture errors during credential-boundary assertions and suppresses expected socket errors after test teardown begins. The routed-tunnel trust loop waits for an expected, not-yet-approved host port before reading the dialog; visibility alone could match the previous hop while its async approval was still completing. Independent standards and spec reviews found no concrete issue in that test diff.

Commit `d594453` implements the partial P-42 security policy summary in Settings. It explains explicit SSH fingerprint approval and changed-key recovery, fixed loopback scope for local/SOCKS tunnels, the remote `GatewayPorts` caveat, and the existing credential-vault controls. It adds no state or IPC. The Windows E2E checks the policy and vault controls. Commit `5532fa8` adds the full-app changed-host-key flow: after rotation the old key stays saved and blocked until explicit reset and a second approval of the new fingerprint. Both independent review axes found no concrete issue. See [WP-02D](results/WP-02D-security-policy-settings-2026-10-29.md) and [WP-02E](results/WP-02E-host-key-rotation-e2e-2026-10-29.md).

The native Windows picker test helper now sets the filename through UI Automation `ValuePattern` and verifies the exact value before submit. Diagnosis found `SendKeys` intermittently dropped one path character, leaving the picker open; the custom-logo E2E passed five consecutive focused runs after the fix. This is test automation only.

P-42's app-managed credential boundary review is complete in [WP-07Z](results/WP-07Z-all-flow-secret-boundary-review-2026-10-29.md). The FTP loopback E2E additionally scans renderer and main console output plus all files in the closed app profile for its credential canary. It passed in isolation and in the full E2E run. User-owned macros/scripts and opt-in SSH transcripts remain documented sensitive-content exceptions; N-002/P-29 are not complete.

## Verification on this Windows x64 machine

- Node `24.14.1`, pnpm `12.15.0`.
- `corepack pnpm check` with workspace-pinned Node `24.14.1` / pnpm `12.15.0`: passed typecheck, lint/import boundaries, 578 unit tests and Windows E2E (70 passed, five package-specific tests skipped by the general E2E command). The changed-host-key E2E, FTP credential scan, SSH credential boundary flows and native picker flows passed.
- Focused custom-logo native-picker E2E with `--repeat-each=5`: 5/5 passed after replacing `SendKeys` filename entry with exact UI Automation value setting.
- Focused SSH route E2E with `--repeat-each=10`: 10 passed.
- Latest `corepack pnpm package:win:smoke`: 5/5 package tests passed against a fresh x64 build, including Electron fuses/ASAR, SBOM/hash validation, NSIS offline launch at 200% scale/uninstall, portable terminal/profile placement, and SSH log finalization on shutdown. One earlier run had a transient portable-terminal visibility failure; its isolated repeat passed 5/5, and this complete rerun passed 5/5.
- The build warns that the minified renderer bundle is about 1,020 kB, above Vite's 500 kB advisory threshold.
- Current unsigned x64 outputs are in `artifacts/windows/`: `MultiRemoteTerminal Setup 0.0.0.exe`, `MultiRemoteTerminal 0.0.0.exe`, per-artifact CycloneDX SBOMs, and `SHA256SUMS.txt`. The generator reports 31 runtime components and `NotSigned` for both executables. The existing `win-packed.zip` is from 2026-10-28 and was not refreshed by the current package script.

## Release status and remaining acceptance

The app is **not release-ready**. M4 requires N-001 through N-007 and the security checklist still has open items. Current Windows loopback and packaged smoke results do not replace these acceptance checks:

- **P-03:** disposable OpenSSH interoperability, the real Windows OpenSSH agent service, and packaged native credential prompting.
- **P-02/P-07/P-08/P-12:** real user WSL distributions and broader Unix tools; actual RDP/VNC interoperability; physical serial device and driver acceptance.
- **P-14/P-15:** native Explorer drag-and-drop, sustained transfer throughput and broader server interoperability.
- **P-22..P-25:** public/non-loopback bind consent, SOCKS UDP/BIND/authentication, routes beyond three hops and broader interoperability.
- **P-20/P-21/P-27/P-30/P-31:** additional daemon/tool providers, toolpack lifecycle, broader text-editor and shell syntax profiles, and third-party provider provenance/install lifecycle.
- **P-28/P-29:** macro secret-prompt detection is heuristic; physical Windows session lock, cross-account restore and DPAPI migration remain open. WP-07Z completes the app-managed credential-flow boundary review.
- **P-32:** signed/verified distribution and Windows 10 acceptance. Current artifacts are unsigned test builds.
- **P-37:** shell/tool install-update-remove lifecycle. P-42's scoped settings and app-managed credential boundary acceptance is VERIFIED; this does not close N-002/P-29.
- Security release gate: dependency/license audit and publication of the generated SBOM and installer hashes remain open. The all-flow app-managed credential review is recorded in WP-07Z; broader user-content, privilege-injection, daemon/X11 policy and platform acceptance remain tracked separately.
- `F-014` remains PARTIAL: broader syntax profiles and full shell grammar are open. Other non-MVP/parity gaps remain in the feature matrix; do not describe the product as full parity.

Use loopback fixtures only for SSH E2E. The confidential company endpoint from the user's report must not be repeated or contacted from this workspace.

## Next steps

1. Refresh remote refs and verify `git branch --show-current`, `git rev-parse HEAD`, and `git ls-remote --heads origin dev-1 main`; keep work on `dev-1` only.
2. Confirm the reviewed test/resume changes are present on `origin/dev-1`; preserve the three user-owned changes above and keep ignored build output untracked.
3. Continue the remaining MVP acceptance items one complete, tested and independently reviewed slice at a time. The next work is the remaining security and interoperability gates, especially installed Windows OpenSSH/native-prompt acceptance, Windows 10, signing/reproducibility, and the physical/per-server interoperability items. Re-run `corepack pnpm check` and `corepack pnpm package:win:smoke` after relevant application changes.
4. Keep M4 blocked until all N-001 through N-007 evidence is in place, the security checklist has no unresolved critical/high findings, and the final version, SBOM/hash publication, signing and reproducibility decisions are verified. Do not modify or merge into `main`.
