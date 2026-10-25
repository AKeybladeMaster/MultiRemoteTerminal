# WP-07N — SFTP path and transfer security acceptance

**Requirements:** N-002 SFTP traversal/transfer security gate; supporting F-005/P-14 evidence.

## Evidence

Focused path and transfer unit suites:

- `node --test tests/unit/remote-files.test.ts tests/unit/sftp-file-transfers.test.ts` — passed, 15/15. Coverage includes remote child traversal rejection, rename collision behavior, explicit overwrite, cancellation staging cleanup, remote and ancestor symlink rejection, and preservation of existing targets on short or conflicting transfers.

Windows loopback application E2E:

- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "SFTP sessions verify trust and transfers" --reporter=line` — passed, 1/1. The real renderer/main/worker path approves first-use host trust, lists and downloads a remote fixture file, uploads and downloads exact bytes, saves/reopens a files-only session, and verifies no shell was requested for that session.

## Status

The focused N-002 checklist item for SFTP traversal, cancellation, symlink and overwrite acceptance is checked in `docs/SECURITY.md`. This does not establish 100 MB transfer performance, network-loss cleanup, or interoperability with public SFTP servers. A hostile server may still race path-based ancestor checks; forced worker termination or lost transport can leave staged files if bounded cleanup cannot finish. F-005/P-14 remain partial for drag/drop, large-file and disconnect acceptance, configurable browser behavior and broader server interoperability.
