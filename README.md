# MultiRemoteTerminal

An independent Windows remote terminal workbench, developed incrementally on `dev-1`.

**Current state: WP-07C verifies the persisted startup greeting; WP-07A's Windows package foundation remains partial.** Earlier terminal, saved-session, SFTP, SSH forwarding, Telnet, FTP/FTPS, macro, offline-help and greeting slices are recorded in the [feature matrix](docs/FEATURE-MATRIX.md). Windows 11 x64 smoke tests install and uninstall the NSIS package, open a local PowerShell terminal, and verify that the portable executable creates its SQLite profile beside itself. The generated `0.0.0` artifacts are unsigned previews, not a release. Saved definitions and the greeting persist in the local SQLite profile across app exits and restarts; there is no separate account sign-in/logout flow. Bash requires a separate Git for Windows installation and is not bundled. SFTP, FTP/FTPS and Telnet have explicit documented interoperability and security limits. The requirements matrix and linked evidence describe what is verified and what remains open.

## Run the development preview

Windows x64; Node **24.14.1**, npm, Python and Visual Studio 2022 C++ Build Tools. The project pins pnpm **12.15.0** and all direct dependencies.

```powershell
npm exec --yes --package=pnpm@12.15.0 -- pnpm install --frozen-lockfile
npm exec --yes --package=pnpm@12.15.0 -- pnpm build
npm exec --yes --package=pnpm@12.15.0 -- pnpm start
```

`pnpm build` compiles the app into `dist/`, including the Windows native bridge. `pnpm start` launches the development preview using Electron's executable and the built app. Electron downloads its pinned Windows runtime on first use (or `pnpm setup:electron`), so initial setup and packaging need network access. If launching from an agent shell with `ELECTRON_RUN_AS_NODE=1`, remove that variable for the child Electron process. The test runner does this without changing the host environment.

## Build Windows executables

On Windows x64, install the prerequisites above, then run:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm package:win
```

The command creates an NSIS installer at `artifacts/windows/MultiRemoteTerminal Setup 0.0.0.exe` and a portable executable at `artifacts/windows/MultiRemoteTerminal 0.0.0.exe`. To choose the portable data location, place the portable executable in a writable folder of your choice; it keeps data in a `MultiRemoteTerminal-data` folder beside the executable. To build and run the install/portable UI smoke checks, use `corepack pnpm package:win:smoke`.

The current artifacts are unsigned development previews. A production release still needs the M4 security, compatibility, signing and distribution checks; see [WP-07A results](docs/results/WP-07A-windows-package-2026-10-25.md).

## Validate

```powershell
npm exec --yes --package=pnpm@12.15.0 -- pnpm check
npm exec --yes --package=pnpm@12.15.0 -- pnpm audit --audit-level=high
npm exec --yes --package=pnpm@12.15.0 -- pnpm dependencies:inventory
```

`check` runs strict project type checks, lint, import boundaries, unit/adapter tests, production build and Electron end-to-end tests. The optional disposable OpenSSH acceptance fixture runs with `pnpm test:ssh-fixture` when `MRT_TEST_SSH_HOST`, `MRT_TEST_SSH_PORT`, `MRT_TEST_SSH_USERNAME`, `MRT_TEST_SSH_PASSWORD` and `MRT_TEST_SSH_FINGERPRINT` point to a test server. Screenshots and failure traces go under ignored `test-results/` and `playwright-report/`.

## Architecture and evidence

- [Offline user guide](docs/USER-GUIDE.md); open Help in the app for the searchable guide and keyboard reference.

- [Start here](docs/CODEX-START-HERE.md), [mandatory rules](AGENTS.md), [canonical specification](docs/SPEC-001-MultiRemoteTerminal.md)
- [Architecture](docs/ARCHITECTURE.md), [security](docs/SECURITY.md), [feature matrix](docs/FEATURE-MATRIX.md), [implementation plan](docs/IMPLEMENTATION-PLAN.md)
- [WP-07A Windows packaging results](docs/results/WP-07A-windows-package-2026-10-25.md), [electron-builder dependency review](docs/dependencies/WP-07-electron-builder.md)
- [WP-07B offline-help results](docs/results/WP-07B-offline-help-2026-10-25.md), [WP-07C startup-greeting results](docs/results/WP-07C-startup-greeting-2026-10-25.md)
- [WP-00 interfaces](docs/WP-00-CONTRACTS.md), [WP-00 results](docs/results/WP-00-2026-10-23.md), [WP-01 results](docs/results/WP-01-2026-10-23.md), [WP-02 SSH results](docs/results/WP-02-ssh-2026-10-23.md), [WP-03A storage results](docs/results/WP-03-storage-2026-10-23.md), [WP-03B catalog results](docs/results/WP-03B-catalog-2026-10-23.md), [WP-03C folder results](docs/results/WP-03C-folders-2026-10-23.md), [WP-03D folder bundle results](docs/results/WP-03D-session-folder-bundles-2026-10-24.md)
- [Dependency decisions](docs/dependencies/)

Domain and application code have no Electron, Node, React, storage or protocol imports. The renderer communicates through typed, validated preload commands; credentials and protocol/storage adapters stay in privileged processes or supervised workers. Main validates window ownership and contracts, and serves only immutable application assets.

## Development and promotion

`main` is the default branch. Work is prepared on `dev-1` and reviewed before promotion. The MVP release gate remains open: Windows 10 coverage, full 1,000-definition acceptance, saved SSH reconnect against OpenSSH, accessibility/high-DPI and offline tests, packaged SSH credential prompting, distribution SBOM, security review and signed/verified packaging decision still need evidence.

## Independence

MultiRemoteTerminal uses original implementation and branding. External tools require provenance and licensing review before integration.
