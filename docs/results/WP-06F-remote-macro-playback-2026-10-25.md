# WP-06F — SSH/Telnet macro playback

**Date:** 2026-10-25 | **Requirement:** F-007 / P-28 (partial) | **Status:** Verified against loopback protocol fixtures; public-server interoperability remains open.

## Behavior verified

- SSH macro playback uses a locally hosted SSH server, explicit first-use host trust and the existing interactive credential flow.
- Telnet macro playback requires the visible plaintext acknowledgement before connecting to a local TCP fixture.
- Both tests create a typed macro, review the exact command and active target, confirm the fixture receives no input before **Run macro**, then verify exactly one command after approval.
- Each fixture returns a unique output marker. The app's literal wait step observes that marker and reports macro completion through the UI.
- Fixtures and app profiles are temporary and are cleaned up after each test.

## Evidence

- `corepack pnpm lint` — passed, including import-boundary checks.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm build` — passed on Windows x64. Vite emitted a large renderer chunk advisory; the build still passed.
- `corepack pnpm exec playwright test --grep "macro playback sends reviewed steps through"` — **2 passed** on Windows: one SSH fixture and one Telnet fixture (6.6 seconds total).

## Remaining acceptance

F-007/P-28 remain partial. Secret-prompt detection is heuristic; interoperability against public or historical SSH/Telnet servers is not established by loopback fixtures.