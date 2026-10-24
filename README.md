# MultiRemoteTerminal

An independent Windows remote terminal workbench, developed incrementally on `dev-1`.

**Current state: WP-01E Git Bash, WP-03D saved-folder bundles, WP-03C folders and WP-01D terminal interactions.** Saved definitions are kept in the per-user SQLite catalog and survive application exit/restart; this app has no separate account sign-in/logout flow. Windows E2E covers explicit save, search, favorites, reopen/delete, nested folder operations, versioned JSON folder export/import across profiles, Bash commands and saved Bash reopen, Bash clipboard paste/resize/tab closure, persistence after restart, `Ctrl+W`/middle-click close confirmation and terminal-tab context actions. Bash requires a separate Git for Windows installation and is not bundled. Clipboard reads stay in the main process; paste requires a trusted, session-bound one-use key gesture, and multiline clipboard text requires native confirmation. Per-session terminal input remains ordered across paste authorization and confirmation; renderer teardown cancels a pending paste before it writes. The checked-in Bash acceptance covers BMP Unicode paste. A separate exploratory probe observed supplementary-character replacement under the tested Git Bash/ConPTY path; this observation is not a checked-in acceptance assertion. Bundles include connection configuration but exclude credentials and terminal history. F-004 remains planned until the full 1,000-definition workflow passes end-to-end; P-02 is partial because WSL and broad Unix-tool coverage are not implemented; P-13 is partial because automatic saving through a user preference is not implemented. F-018 is partial because settings templates and encrypted secret export remain outstanding. Saved SSH reconnect still needs a disposable OpenSSH test. There is no installable or portable `.exe` package yet. P-30 syntax highlighting also remains planned; the ANSI color palette is contrast-tested but does not parse command syntax.

## Run the development preview

Windows x64; Node **24.14.1**, npm, Python and Visual Studio 2022 C++ Build Tools. The project pins pnpm **12.15.0** and all direct dependencies.

```powershell
npm exec --yes --package=pnpm@12.15.0 -- pnpm install --frozen-lockfile
npm exec --yes --package=pnpm@12.15.0 -- pnpm build
npm exec --yes --package=pnpm@12.15.0 -- pnpm start
```

`pnpm build` compiles the app into `dist/`, including the Windows native bridge. It does not create a standalone installer or app `.exe`. `pnpm start` launches the preview using Electron's executable and the built app. Electron downloads its pinned Windows runtime on first use (or `pnpm setup:electron`), so installation and first build need network access. The preview uses standard per-user Electron app data; portable mode is not implemented. If launching from an agent shell with `ELECTRON_RUN_AS_NODE=1`, remove that variable for the child Electron process. The test runner does this without changing the host environment.

## Validate

```powershell
npm exec --yes --package=pnpm@12.15.0 -- pnpm check
npm exec --yes --package=pnpm@12.15.0 -- pnpm audit --audit-level=high
npm exec --yes --package=pnpm@12.15.0 -- pnpm dependencies:inventory
```

`check` runs strict project type checks, lint, import boundaries, unit/adapter tests, production build and Electron end-to-end tests. The optional disposable OpenSSH acceptance fixture runs with `pnpm test:ssh-fixture` when `MRT_TEST_SSH_HOST`, `MRT_TEST_SSH_PORT`, `MRT_TEST_SSH_USERNAME`, `MRT_TEST_SSH_PASSWORD` and `MRT_TEST_SSH_FINGERPRINT` point to a test server. Screenshots and failure traces go under ignored `test-results/` and `playwright-report/`.

## Architecture and evidence

- [Start here](docs/CODEX-START-HERE.md), [mandatory rules](AGENTS.md), [canonical specification](docs/SPEC-001-MultiRemoteTerminal.md)
- [Architecture](docs/ARCHITECTURE.md), [security](docs/SECURITY.md), [feature matrix](docs/FEATURE-MATRIX.md), [implementation plan](docs/IMPLEMENTATION-PLAN.md)
- [WP-00 interfaces](docs/WP-00-CONTRACTS.md), [WP-00 results](docs/results/WP-00-2026-10-23.md), [WP-01 results](docs/results/WP-01-2026-10-23.md), [WP-02 SSH results](docs/results/WP-02-ssh-2026-10-23.md), [WP-03A storage results](docs/results/WP-03-storage-2026-10-23.md), [WP-03B catalog results](docs/results/WP-03B-catalog-2026-10-23.md), [WP-03C folder results](docs/results/WP-03C-folders-2026-10-23.md), [WP-03D folder bundle results](docs/results/WP-03D-session-folder-bundles-2026-10-24.md)
- [Dependency decisions](docs/dependencies/)

Domain and application code have no Electron, Node, React, storage or protocol imports. The renderer communicates through typed, validated preload commands; credentials and protocol/storage adapters stay in privileged processes or supervised workers. Main validates window ownership and contracts, and serves only immutable application assets.

## Development and promotion

`main` is the default branch. Work is prepared on `dev-1` and reviewed before promotion. An MVP release requires complete MVP behavior, Windows smoke/E2E and installer/portable tests, security review, and a signing/verified packaging decision. The current preview does not satisfy that release gate. Next: verify full 1,000-definition acceptance, complete auto-save/settings, test saved SSH reconnect against OpenSSH, and implement the SFTP workflow.

## Independence

MultiRemoteTerminal uses original implementation and branding. External tools require provenance and licensing review before integration.
