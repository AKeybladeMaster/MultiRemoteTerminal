# ADR-0005 — Built-in SQLite in the storage worker

**Status:** Accepted for the first WP-03 storage phase (2026-10-23)

## Context

WP-03 needs transactional SQLite migrations and host-key migration from the interim JSON store. The architecture assigns database ownership to a utility worker so synchronous storage work cannot stall Electron main. Electron is pinned to 45.0.0.

## Decision

- Use Electron's embedded Node `node:sqlite` `DatabaseSync` API inside the storage utility process. The process owns the database connection and receives only versioned, bounded requests from main. Main derives the database path from `app.getPath('userData')`; no renderer value can choose a file path.
- Propagate SSH-session cancellation through host-trust lookup to the storage request and the one-time legacy migration. Callers share that migration; cancellation of one waiter does not interrupt work needed by the others, while cancellation of the last waiter terminates the worker. Any other pending requests fail as unavailable and a later request starts a fresh worker. SQLite transactions remain atomic on process termination. The legacy import is idempotent and the JSON source is retained until a complete reply is verified.
- Keep SQLite calls synchronous inside that utility process. Enable foreign keys and WAL; bound lock waits to five seconds; leave extension loading disabled and defensive mode enabled. All data values use prepared-statement parameters.
- Pin schema migrations with SQLite `user_version`. Schema changes are additive and transactional; unknown future versions and corrupt stores fail closed. Schema version 1 creates the logical tables from `docs/ARCHITECTURE.md`.
- Make `ssh_host_keys` unique by canonical host and port, preserving the trust policy's single active identity per endpoint. A changed key remains blocked until a separate explicit revoke and approval.
- Import validated legacy host identities in one SQLite transaction, then verify every imported endpoint, fingerprint and source count. Remove the JSON file only if its content hash still matches the snapshot that was imported. A crash before deletion safely retries the idempotent migration on next use.
- Do not add an npm package or native SQLite addon. Node 24's SQLite API is documented as Release Candidate from Node 24.15. Electron 45 embeds Node 24.22.0; keep Electron pinned and run an Electron utility-process schema smoke test. Reassess the runtime API status and migration behavior before changing Electron major/minor lines.
- Publish only static `{component, event, code}` storage diagnostics to the local `diagnostics_channel` opt-in surface. Do not include request IDs, database paths, SQL, hostnames, key material or storage values; no subscriber is installed by default.

## Consequences

The storage worker avoids introducing another native ABI dependency or package into the Windows build. `node:sqlite` is still a Release Candidate API in this pinned runtime line, so upgrading Electron requires an explicit compatibility review. This phase migrates host trust only; persisted session CRUD, settings commands and catalog UI remain subsequent WP-03 work.

## References

- [Node.js v24 SQLite API](https://nodejs.org/download/release/v24.20.0/docs/api/sqlite.html)
- [Electron 45 release announcement](https://www.electronjs.org/blog/electron-45-0)
