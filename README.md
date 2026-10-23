# MultiRemoteTerminal

An independent Windows remote terminal workbench, developed incrementally on `dev-1`.

**Current state: WP-00 foundation preview.** The Electron shell, validated preload command, original design tokens and Windows security tests work. Terminal sessions, SSH, storage, SFTP, tunnels and macros are planned; there is no installable MVP or release package yet. The feature matrix keeps those workflows planned.

## Run the development preview

Windows x64; Node **24.14.1**, npm available, Git. The project pins pnpm **12.15.0** and all direct dependencies. No global tools are required.

```powershell
npm exec --yes --package=pnpm@12.15.0 -- pnpm install --frozen-lockfile
npm exec --yes --package=pnpm@12.15.0 -- pnpm build
npm exec --yes --package=pnpm@12.15.0 -- pnpm start
```

Electron downloads its pinned Windows runtime on first use (or `pnpm setup:electron`). Builds and the initial install need network access. The preview uses standard per-user Electron app data; portable mode is not implemented. If launching from an agent shell with `ELECTRON_RUN_AS_NODE=1`, remove that variable for the child Electron process. The test runner does this without changing the host environment.

## Validate

```powershell
npm exec --yes --package=pnpm@12.15.0 -- pnpm check
npm exec --yes --package=pnpm@12.15.0 -- pnpm audit --audit-level=high
npm exec --yes --package=pnpm@12.15.0 -- pnpm dependencies:inventory
```

`check` runs strict project type checks, lint, import fitness rules, unit/adapter tests, production build and actual Electron tests. The sandbox stays enabled. Tests use disposable app profiles; screenshots and failure traces go under ignored `test-results/` and `playwright-report/`. Windows CI runs the same checks. No SSH fixture is needed yet because no SSH operation exists.

## Architecture and evidence

- [Start here](docs/CODEX-START-HERE.md), [mandatory rules](AGENTS.md), [canonical specification](docs/SPEC-001-MultiRemoteTerminal.md)
- [Architecture](docs/ARCHITECTURE.md), [security](docs/SECURITY.md), [feature matrix](docs/FEATURE-MATRIX.md), [implementation plan](docs/IMPLEMENTATION-PLAN.md)
- [WP-00 interfaces](docs/WP-00-CONTRACTS.md), [Windows results](docs/results/WP-00-2026-10-23.md)
- [Dependency decisions](docs/dependencies/WP-00.md), [initial SBOM](docs/dependencies/wp-00-sbom.cdx.json)

Domain and application code have no Electron, Node, React, storage or protocol imports. The renderer receives one read-only capability via preload. Main validates ownership and contracts; only immutable application assets are served. Future PTY/network/storage adapters will use supervised utility workers according to the architecture.

## Development and promotion

`main` is the default branch. Work is prepared on `dev-1`, reviewed, and merged into `main`. An MVP release requires complete MVP behavior, Windows smoke/E2E and installer/portable tests, security review, and a signing/verified packaging decision. WP-00 does not satisfy that release gate. Next: WP-01, real local ConPTY terminals with lifecycle and cleanup tests.

## Independence

MultiRemoteTerminal uses original implementation and branding. External tools require provenance and licensing review before integration.
