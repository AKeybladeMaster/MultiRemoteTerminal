# WP-09A — Telnet profile foundation

This phase adds a credential-free `telnet` saved-session definition backed by the existing SQLite catalog and session-folder JSON bundles. Host and port use a shared domain `RemoteEndpoint` validator, which also backs the existing SSH endpoint canonicalization. Telnet profile data contains only the normalized endpoint and normal saved-session metadata; credentials are rejected by the exact schema.

This is a data-model foundation only. There is no live Telnet transport, warning-gated connection flow, or Windows Telnet acceptance yet. P-04 remains PLANNED.

## Validation

- `corepack pnpm exec node --test tests/unit/remote-endpoint.test.ts tests/unit/session-catalog.test.ts tests/unit/contracts.test.ts` — passed, 18/18 tests.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including import-boundary checks.
- `corepack pnpm build` — passed on Windows x64; the existing renderer chunk-size advisory remains (about 609 kB minified).
- `git diff --check` — passed.

## Standards references

- [RFC 854 — Telnet Protocol Specification](https://www.rfc-editor.org/rfc/rfc854.html) defines Telnet as a TCP byte stream with interspersed control information and negotiated options.
- [RFC 1073 — Telnet Window Size Option](https://www.rfc-editor.org/rfc/rfc1073.html) defines the NAWS option used to communicate terminal dimensions.
- [RFC 1091 — Telnet Terminal-Type Option](https://www.rfc-editor.org/rfc/rfc1091.html) defines terminal-type negotiation.
