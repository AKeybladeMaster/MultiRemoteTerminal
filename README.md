# MultiRemoteTerminal

An independent Windows remote terminal workbench, developed incrementally on `dev-1`.

**Current state: WP-03B partial saved-session catalog.** Windows local terminals, SQLite-backed host-trust migration, and basic local/SSH saved-session metadata operations have Windows end-to-end coverage. The catalog supports explicit save, search, favorites, reopen and delete, and stores no credentials or terminal history. Full folder management and the remaining catalog acceptance work are still pending. SSH acceptance remains pending until a real disposable OpenSSH handshake is verified. There is no installable or portable `.exe` package yet.

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
- [WP-00 interfaces](docs/WP-00-CONTRACTS.md), [WP-00 results](docs/results/WP-00-2026-10-23.md), [WP-01 results](docs/results/WP-01-2026-10-23.md), [WP-02 SSH results](docs/results/WP-02-ssh-2026-10-23.md), [WP-03A storage results](docs/results/WP-03-storage-2026-10-23.md), [WP-03B catalog results](docs/results/WP-03B-catalog-2026-10-23.md)
- [Dependency decisions](docs/dependencies/)

Domain and application code have no Electron, Node, React, storage or protocol imports. The renderer communicates through typed, validated preload commands; credentials and protocol/storage adapters stay in privileged processes or supervised workers. Main validates window ownership and contracts, and serves only immutable application assets.

## Development and promotion

`main` is the default branch. Work is prepared on `dev-1` and reviewed before promotion. An MVP release requires complete MVP behavior, Windows smoke/E2E and installer/portable tests, security review, and a signing/verified packaging decision. The current preview does not satisfy that release gate. Next: complete folder CRUD, catalog recovery/import-export acceptance, and remaining WP-03 settings work.

## Independence

MultiRemoteTerminal uses original implementation and branding. External tools require provenance and licensing review before integration.
