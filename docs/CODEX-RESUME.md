# Codex resume snapshot — 2026-10-28

Use this dated snapshot when moving work to another PC. Refresh Git refs and test state before editing; [`SPEC-001`](SPEC-001-MultiRemoteTerminal.md), [`FEATURE-MATRIX`](FEATURE-MATRIX.md), [`IMPLEMENTATION-PLAN`](IMPLEMENTATION-PLAN.md), architecture, security, glossary, and ADR documents remain the requirements source of truth.

## Project and branch

- Repository: `AKeybladeMaster/MultiRemoteTerminal`, an independent Windows remote-terminal workbench.
- The current user-directed work branch is `dev-1`. At the start of this handoff follow-up its tip was `d6a4c828140b24b291d65f7b2ae098b257412981` (`feat(editor): add Java properties syntax profile`).
- Refreshed remote tips at that point: `origin/dev-1` = `d6a4c82`, `origin/main` = `e24f2f2`, and `origin/dev` = `222e151`. `origin/main` was an ancestor of `dev-1`, which was 16 commits ahead. The task changes in this handoff follow that `dev-1` base; use `git log d6a4c82..dev-1 --oneline` to inspect them.
- The requested `main` promotion was conditional, and was not performed because the branch-wide E2E suite below is not green. Re-evaluate only after the failures are fixed or explained and the full check passes. Preserve history with a regular merge commit; never force-push.
- The local checkout also had user-owned edits in `AGENTS.md`, `pnpm-workspace.yaml`, and new files under `docs/agents/`. Keep such local edits out of feature commits unless the user explicitly directs otherwise.

## Completed in this handoff

The portable SSH-log shutdown test now fills the native Save dialog through the shared `Set-DialogFilename` helper. It verifies the selected `.log` path by waiting for that exact file to be created. This changes test automation only; it adds no product behavior. Independent Standards and Spec reviews approved the change.

WP-02C / F-027 / P-45 remains verified for user-consented, bounded local SSH session logging. The Windows loopback and portable-package checks do not verify an external SSH server or VPN route. Never infer the cause of a live connection timeout from a generic `TIMEOUT` result.

## Verification

- Focused portable SSH-log shutdown E2E: **3/3 passed**.
- `corepack pnpm package:win:smoke` under Node 24.14.1 and pnpm 12.15.0: **5/5 passed** (ASAR/fuses, SBOM and checksums, NSIS offline install/uninstall, portable local terminal, and portable SSH-log shutdown).
- `corepack pnpm check` under Node 24.14.1: typecheck and lint passed; unit tests **578/578 passed**; source E2E **54 passed, 14 failed, 5 skipped**. The package cases were skipped by this command and passed in the separate package smoke above.

The 14 source E2E failures from that run were:

- Local TOML, YAML, and Markdown text-editor profile cases timed out.
- SSH quick-connect and SQLite storage-worker E2Es reported their utility worker exited before replying.
- Serial saved-folder export expected bundle version 6 but received version 7.
- Macro playback had an ambiguous button locator; terminal-tab actions could not focus the expected menu item.
- Terminal-resize, real local-terminal, and Git Bash E2Es failed their assertions.
- Startup-greeting and automatic-session-save E2Es matched two `role="status"` elements.
- Command-palette shell-visibility E2E did not observe the expected `aria-current` value.

These failures are not yet established as pre-existing. Playwright saved local error contexts under `test-results/`; they are generated artifacts, not source files. Triage each failure before a `main` promotion.

## Windows artifacts

The latest unsigned x64 NSIS and portable builds are in `artifacts/windows/`:

- `MultiRemoteTerminal Setup 0.0.0.exe`
- `MultiRemoteTerminal 0.0.0.exe`
- Per-artifact CycloneDX SBOMs and `SHA256SUMS.txt`

The build is `NotSigned` because no signing certificate is configured. Build outputs are ignored and are not in Git. The existing `artifacts/windows/win-packed.zip` predates this build (12:27 versus the current EXEs at 23:14–23:17); regenerate it before transport. On a new PC, use the repo-pinned Node and pnpm versions; inspect `package.json` and `pnpm-workspace.yaml` for the current pins. On this PC, Node 24.14.1 was available under `.tmp/toolchain/node-v24.14.1-win-x64/` and pnpm was 12.15.0.

## Next actions

1. Re-fetch `origin` and confirm the current branch and worktree before proceeding.
2. Triage the 14 source E2E failures, separating stale test assertions from runtime problems; run focused reproductions and then `corepack pnpm check` again.
3. Keep `main` unchanged for this snapshot. Reconsider the requested conditional merge only after the full check and independent reviews pass.
4. After branch promotion is safe, choose the next complete slice from [`FEATURE-MATRIX`](FEATURE-MATRIX.md) and [`IMPLEMENTATION-PLAN`](IMPLEMENTATION-PLAN.md). Preserve explicit PARTIAL statuses and their remaining acceptance gates.
