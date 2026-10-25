# WP-09E.1 — Serial saved-profile acceptance evidence

**Date:** 2026-10-25
**Platform:** Windows 11 x64, Electron 45.0.0, Node 24.14.1
**Scope:** persistent serial profile metadata, saved-folder bundle v6, legacy bundle import and mock-port reconnect.

## Results

- TypeScript workspace typecheck: passed.
- ESLint and static import-boundary checks: passed.
- Focused domain/catalog/bundle unit tests: 21 passed, 0 failed. They cover serial option validation, SQLite create/read/favorite, null host/port and credential reference storage, folder export/import and idempotence, rejection of invalid COM settings, and bundle versions 1–5 compatibility.
- Windows serial utility-worker E2E: 2 passed, 0 failed. The scenarios cover existing serial I/O and tab actions plus profile save, folder placement/export, import into another user-data profile, persistence across app restart, settings restoration and explicit COM mock reconnect. A profile pointing to an absent COM port stays unavailable until the user selects a listed port.
- Windows x64 build: passed. Vite reports the existing renderer bundle is above its 500 kB warning threshold.
- `git diff --check`: passed.

No physical COM device was opened. Hot-unplug recovery, device-driver signature verification, FTPS interoperability and release signing remain outside this acceptance result.
