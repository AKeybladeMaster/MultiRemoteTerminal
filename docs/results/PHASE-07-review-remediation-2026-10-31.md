# Phase 07 review remediation - 2026-10-31

Three independent read-only reviews examined specification fit, architecture, and security after the prior gate.

## Findings and changes

- **Specification:** P-25 (SOCKS authentication, BIND, UDP ASSOCIATE) and broader N-010 recovery remain explicitly partial. The reviewer found stale acceptance wording for eight-hop and restart tests; these statements are being reconciled against the final rerun.
- **Architecture:** Transfer lifecycle persistence and outcome mapping were in the Electron main broker. Moved that orchestration into `packages/application/src/file-transfer-recovery.ts`; the broker now dispatches the transport operation and supplies UI callbacks.
- **Recovery reachability:** A fixed 100-row query left older interruption records inaccessible. Added deterministic keyset pagination, validated cursor/page shapes at domain, worker, and IPC boundaries, an older-record UI action, and targeted lookup for revealing older local download stages. Tests and a Windows restart E2E exercise more than one page.
- **Security:** A SQLite backup could overwrite the retained restore point before validating the new snapshot. The migration now writes a unique sibling candidate, checks its schema version and `quick_check`, then renames it over the retained snapshot. A regression test verifies an invalid candidate preserves the prior snapshot.

## Verification status

These source and test changes are not yet run. The previous code and package gates predate this remediation and are not evidence for the current candidate. Phase 07 remains unaccepted because SOCKS5 BIND/UDP/authentication, additional N-010 reconciliation/configuration recovery, and live SSH interoperability remain open. No commit, push, or promotion occurred.