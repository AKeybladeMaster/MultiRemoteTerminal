# ADR-0020 — Persist serial profiles and extend folder bundles

- **Status:** Accepted
- **Date:** 2026-10-25
- **Context:** WP-09E added live Windows COM sessions, but serial settings could not be saved with the session catalog or folder-bundle transfer. The existing SQLite schema already permits `kind = 'serial'` and has a versioned `options_json` field.
- **Decision:** Represent a serial saved session with its validated COM path and port settings as non-secret profile metadata. Persist the whole configuration in `options_json`; keep the generic `host` and `port` columns null and never attach a credential reference. Increment saved-folder bundle format to version 6, validate serial configuration with the shared domain normalizer, and continue accepting versions 1–5 under their original protocol-kind limits.
- **Safety behavior:** Opening a saved profile refreshes the live COM list but preserves a missing saved path. The user must explicitly choose a listed port and press Connect before the app opens a device. A profile does not persist USB serial numbers or other device-identifying metadata.
- **Consequences:** No SQLite schema migration is needed. Catalog reads, folder subtree exports, idempotent imports, favorites and deletes must recognize the serial kind. Version-5 bundles continue to import VNC records but reject serial records; version 6 accepts both.
- **Verification:** Unit tests cover strict configuration validation, persistence, favorites and bundle compatibility/round-trip. Windows mock-backed E2E covers save, folder export/import, app restart and explicit reconnect without opening physical hardware. See [WP-09E.1 results](../results/WP-09E1-serial-profiles-2026-10-25.md).
