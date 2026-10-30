# Codex resume snapshot — 2026-10-30

Treat `docs/SPEC-001-MultiRemoteTerminal.md`, `docs/FEATURE-MATRIX.md`, `docs/IMPLEMENTATION-PLAN.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, the glossary and relevant ADRs as the requirements source of truth. Refresh Git state before editing.

## Git and workspace

- Repository: `AKeybladeMaster/MultiRemoteTerminal`; work branch: `dev-1`.
- P-42 Settings policy summary is committed as `d594453 feat(settings): explain connection security policy`; host-key rotation acceptance is `5532fa8 test(security): verify SSH host-key rotation flow`; native picker test stabilization is `e99584d test(e2e): stabilize native file picker selection`. All three were pushed and verified on `origin/dev-1`. Refreshed remote check on 2026-10-30: local `dev-1` and `origin/dev-1` are both `1182c96ec337d36b3c7d3e6f1c5fec80b2989da9`; `origin/dev=222e15138a1b43476ff7fc2ffa7395b5c889e92d`; `origin/main=67812739ba521d57007e15faa24e0b5a09d56e06`. `origin/dev` and `origin/main` are ancestors of `dev-1`; no branch was merged or changed by this check.
- Preserve the user-owned worktree changes: modified `AGENTS.md`, modified `pnpm-workspace.yaml`, and untracked `docs/agents/`. Do not stage them.
- Build/test output is ignored: `.tmp/`, `dist/`, `test-results/`, `playwright-report/`, `artifacts/` and `apps/desktop/native/build/`. Do not commit generated outputs or `session-context.md`.

## Current resumed slice — WP-01E resize/input

- The worktree is on `dev-1` at `1182c96`, with no new commit or push from this resumed work. Only the remote-tracking refs were refreshed.
- Preserve modified `AGENTS.md`, modified `pnpm-workspace.yaml`, and untracked `docs/agents/`; do not stage them. Keep ignored `session-context.md`, `.tmp/`, `dist/`, native build output and Playwright output out of commits.
- The outstanding P-02/F-002 Windows issue is intermittent first-character loss when typing immediately after resizing Git Bash under system ConPTY. An unskipped focused E2E passed 5/5, then passed 14/20; six failures showed `rintf` and `bash: rintf: command not found`. The focused test is now explicitly skipped. P-02/F-002 remain PARTIAL and this blocks release readiness. The resize evidence is [WP-01E local resize](results/WP-01E-local-resize-2026-10-29.md).
- Current upstream corroboration: [VS Code issue #275625](https://github.com/microsoft/vscode/issues/275625) includes a Windows 11 / VS Code 1.113 report of the first character disappearing when typing immediately after maximizing/restoring Git Bash with either ConPTY DLL setting. It does not establish this app's cause or a fix.
- The standalone `.tmp/resize-pty-repro.mjs` could not run in this Codex shell: the non-TTY run reported `AttachConsole failed`, and the TTY run timed out before its synthetic Bash prompt. Neither is resize/input evidence; use the Electron E2E for the app-level repro.
- Follow-up diagnosis: the same resize/input probe passed 10/10 with `cat` and 10/10 with Bash Readline disabled (`--noediting`), suggesting the interactive Bash/MSYS line-editing path but not proving its exact cause. A fresh temporary `HOME` did not eliminate the failure (17/20 passed, three lost the first character). A temporary xterm 6.1 beta Win32 Input Mode experiment still failed 5/20 with the same leading-character loss and was reverted to stable xterm 6.0.0 due lack of improvement and known keyboard-layout risk. A temporary one-line clipboard-paste probe passed 12/20 and lost the same leading character in eight runs. Bundled ConPTY passed 13/20, with four resize input losses and three startup prompt timeouts, so system ConPTY was restored. The resize test remains skipped pending a real fix.
- Current preload changes order local writes/paste around resize requests without an arbitrary delay. A standards review found that an already-sent paste also needed to drain before resize; the code now tracks dispatched local writes and paste together and the inverse-order unit test covers it. Both standards and spec reviewers confirmed their fixes; the spec review caught and corrected the matrix's previous overstatement that PTY resize was verified.
- The same worktree also upgrades `re2js` from 2.8.6 to 2.8.7 to remediate CVE-2026-116795/GHSA-gg6h-894w-4m9c. The renderer/domain manifests, lockfile and dependency evidence are updated. A prior `pnpm audit` returned no known vulnerabilities.
- Latest verification on this Windows x64 machine used Node 24.14.1 and pnpm 12.15.0: `pnpm check` completed typecheck, lint/import-boundary checks, unit tests and Windows E2E (70 passed, six skipped: the P-02 resize regression and five package-only tests). Fresh `pnpm package:win:smoke` passed 5/5 for x64 NSIS/portable artifacts, SBOM and hashes, offline high-DPI install/uninstall, portable launch/profile placement, and SSH log finalization. `pnpm audit` reports no known vulnerabilities. The Vite build still warns about the 1,025.93 kB renderer chunk. Fresh unsigned executables, per-artifact SBOMs, and `SHA256SUMS.txt` are under ignored `artifacts/windows/`; `win-packed.zip` was refreshed with these files and updater metadata. Stable-xterm 14/20, temporary beta 15/20, clipboard-paste 12/20, fresh-`HOME` 17/20 and bundled-ConPTY 13/20 results are diagnostic, not acceptance.
- A hash-verified official Node 24.14.1 Windows x64 archive is temporarily under ignored `.tmp/node-v24.14.1-win-x64`; use that directory first on `PATH` when invoking pnpm because the installed global Node is 24.14.0 while the repo pins 24.14.1. It was not installed globally.
- Independent review: Standards and Spec reviewers reported one finding each, both fixed; each reviewer rechecked and confirmed no remaining finding. No reviewer modified the checkout.

## Earlier code slices already recorded

The editor syntax-preview row virtualization is committed as `0012a86`.

Commit `32b1877` captures SSH fixture errors during credential-boundary assertions and suppresses expected socket errors after test teardown begins. The routed-tunnel trust loop waits for an expected, not-yet-approved host port before reading the dialog; visibility alone could match the previous hop while its async approval was still completing. Independent standards and spec reviews found no concrete issue in that test diff.

Commit `d594453` implements the partial P-42 security policy summary in Settings. It explains explicit SSH fingerprint approval and changed-key recovery, fixed loopback scope for local/SOCKS tunnels, the remote `GatewayPorts` caveat, and the existing credential-vault controls. It adds no state or IPC. The Windows E2E checks the policy and vault controls. Commit `5532fa8` adds the full-app changed-host-key flow: after rotation the old key stays saved and blocked until explicit reset and a second approval of the new fingerprint. Both independent review axes found no concrete issue. See [WP-02D](results/WP-02D-security-policy-settings-2026-10-29.md) and [WP-02E](results/WP-02E-host-key-rotation-e2e-2026-10-29.md).

The native Windows picker test helper now sets the filename through UI Automation `ValuePattern` and verifies the exact value before submit. Diagnosis found `SendKeys` intermittently dropped one path character, leaving the picker open; the custom-logo E2E passed five consecutive focused runs after the fix. This is test automation only.

P-42's app-managed credential boundary review is complete in [WP-07Z](results/WP-07Z-all-flow-secret-boundary-review-2026-10-29.md). The FTP loopback E2E additionally scans renderer and main console output plus all files in the closed app profile for its credential canary. It passed in isolation and in the full E2E run. User-owned macros/scripts and opt-in SSH transcripts remain documented sensitive-content exceptions; N-002/P-29 are not complete.

## Verification on this Windows x64 machine

- Node `24.14.1`, pnpm `12.15.0`.
- `corepack pnpm check` with workspace-pinned Node `24.14.1` / pnpm `12.15.0`: passed typecheck, lint/import boundaries, unit tests and Windows E2E (70 passed, six skipped: the resize acceptance and five package-only tests). The changed-host-key E2E, FTP credential scan, SSH credential boundary flows and native picker flows passed.
- Focused custom-logo native-picker E2E with `--repeat-each=5`: 5/5 passed after replacing `SendKeys` filename entry with exact UI Automation value setting.
- Focused SSH route E2E with `--repeat-each=10`: 10 passed.
- Latest `corepack pnpm package:win:smoke`: 5/5 package tests passed against a fresh x64 build, including Electron fuses/ASAR, SBOM/hash validation, NSIS offline launch at 200% scale/uninstall, portable terminal/profile placement, and SSH log finalization on shutdown. One earlier run had a transient portable-terminal visibility failure; its isolated repeat passed 5/5, and this complete rerun passed 5/5.
- The build warns that the minified renderer bundle is about 1,020 kB, above Vite's 500 kB advisory threshold.
- Current unsigned x64 outputs are in `artifacts/windows/`: `MultiRemoteTerminal Setup 0.0.0.exe`, `MultiRemoteTerminal 0.0.0.exe`, per-artifact CycloneDX SBOMs, `SHA256SUMS.txt`, and the refreshed `win-packed.zip` transfer archive. The generator reports 31 runtime components and `NotSigned` for both executables. The zip was assembled locally because the package script generates the artifacts but does not refresh that archive.

## Release status and remaining acceptance

The app is **not release-ready**. M4 requires N-001 through N-007 and the security checklist still has open items. Current Windows loopback and packaged smoke results do not replace these acceptance checks:

- **P-03:** one-run disposable OpenSSH acceptance against Git for Windows OpenSSH 9.7p1 passed in the development app (public-key auth, explicit host-key trust, and an interactive command; see [WP-02F](results/WP-02F-loopback-openssh-2026-10-30.md)). The real Windows OpenSSH agent service, packaged native credential prompt, and broader interoperability remain unverified.
- This workstation has the Windows OpenSSH client, but its `ssh-agent` service is `Stopped/Disabled` and no Windows `sshd` service is registered. A read-only query listed five WSL distributions and three serial ports; no service, distro, or port was started or opened.
- **P-02/P-07/P-08/P-12:** real user WSL distributions and broader Unix tools; actual RDP/VNC interoperability; physical serial device and driver acceptance.
- **P-14/P-15:** native Explorer drag-and-drop, sustained transfer throughput and broader server interoperability.
- **P-22..P-25:** public/non-loopback bind consent, SOCKS UDP/BIND/authentication, routes beyond three hops and broader interoperability.
- **P-20/P-21/P-27/P-30/P-31:** additional daemon/tool providers, toolpack lifecycle, broader text-editor and shell syntax profiles, and third-party provider provenance/install lifecycle.
- **P-28/P-29:** macro secret-prompt detection is heuristic; physical Windows session lock, cross-account restore and DPAPI migration remain open. WP-07Z completes the app-managed credential-flow boundary review.
- **P-32:** signed/verified distribution and Windows 10 acceptance. Current artifacts are unsigned test builds.
- **P-37:** shell/tool install-update-remove lifecycle. P-42's scoped settings and app-managed credential boundary acceptance is VERIFIED; this does not close N-002/P-29.
- Security release gate: dependency/license audit and publication of the generated SBOM and installer hashes remain open. [WP-07AA](results/WP-07AA-dependency-license-inventory-2026-10-30.md) records 29 production records, 332 workspace-root records and 359 recursive workspace records; 25 build/test package names lack top-level license files and need review. Legal compatibility and publication remain unverified. The all-flow app-managed credential review is recorded in WP-07Z; broader user-content, privilege-injection, daemon/X11 policy and platform acceptance remain tracked separately.
- `F-014` remains PARTIAL: broader syntax profiles and full shell grammar are open. Other non-MVP/parity gaps remain in the feature matrix; do not describe the product as full parity.

Use loopback fixtures only for SSH E2E. The confidential company endpoint from the user's report must not be repeated or contacted from this workspace.

## Next steps

1. Refresh remote refs and verify `git branch --show-current`, `git rev-parse HEAD`, and `git ls-remote --heads origin dev-1 main`; keep work on `dev-1` only.
2. Confirm the reviewed test/resume changes are present on `origin/dev-1`; preserve the three user-owned changes above and keep ignored build output untracked.
3. Continue the remaining MVP acceptance items one complete, tested and independently reviewed slice at a time. The next work is the remaining security and interoperability gates, especially installed Windows OpenSSH/native-prompt acceptance, Windows 10, signing/reproducibility, and the physical/per-server interoperability items. Re-run `corepack pnpm check` and `corepack pnpm package:win:smoke` after relevant application changes.
4. Keep M4 blocked until all N-001 through N-007 evidence is in place, the security checklist has no unresolved critical/high findings, and the final version, SBOM/hash publication, signing and reproducibility decisions are verified. Do not modify or merge into `main`.
