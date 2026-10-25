# WP-07G — Electron release fuses

**Slice:** WP-07 security hardening; `N-002` and `P-32` evidence. This slice strengthens packaged runtime configuration; it does not complete the independent N-002 security review or the M4 release gate.

## Change

- Added pinned, development-only `@electron/fuses@2.1.3` after reviewing license, maintenance, Node support, package size, and Windows executable support.
- Added a Windows `afterPack` hook with `strictlyRequireAllFuses: true`, so an unknown or missing fuse fails packaging instead of silently inheriting Electron defaults.
- Disabled `RunAsNode`, `NODE_OPTIONS`/`NODE_EXTRA_CA_CERTS`, Node inspector arguments, and extra `file://` privileges. Enabled cookie encryption, embedded ASAR integrity, and ASAR-only app loading. Kept Wasm trap handlers enabled and the unused browser-specific V8 snapshot disabled.
- Added package smoke assertions for all nine fuse wire states. The package tests now start installed and portable executables with a test-only loopback DevTools port. Playwright's `electron.launch()` adds `--inspect=0`, which is intentionally rejected by the production inspector fuse; using loopback CDP preserves production hardening while testing the shipped UI and terminal.

## Validation

On Windows x64 with Electron 45.0.0, Node 24.14.1 and pnpm 12.15.0:

- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including import-boundary checks.
- `corepack pnpm package:win:smoke` — passed; four packaged E2E tests passed for fuse readback, artifact SBOM/hash manifests, NSIS install/offline/200%-scale/persistence/local PowerShell/restart/uninstall, and portable startup/local PowerShell/profile placement.
- The installer and portable artifacts are `NotSigned`; no publisher certificate was configured.

The packaged smoke proves fuse settings and launch behavior. It does not test app termination after deliberate ASAR tampering. The independent N-002 security review, Windows 10 acceptance, native credential dialog/live SSH authentication, OS-wide offline operation, and signed release remain open.

See [the Electron fuses dependency review](../dependencies/WP-07-electron-fuses.md) and the official [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security/) and [ASAR integrity guide](https://www.electronjs.org/docs/latest/tutorial/asar-integrity).
