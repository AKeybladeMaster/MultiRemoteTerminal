# WP-04B loopback-requested remote SSH forwarding — Windows evidence

**Date:** 2026-10-24

**Branch:** `dev-1`
**Requirements:** F-006; P-24 (partial)

## Delivered behavior

- Save, edit, list and delete local or remote SSH-forward definitions linked to
  saved SSH/SFTP profiles. Definitions remain persisted and stopped after app
  restart; the server-assigned port is runtime-only.
- Remote forwarding starts only after an explicit action and requests a
  `127.0.0.1` listener through SSH `forwardIn`. Port `0` uses the assigned
  server port reported after a successful bind.
- Before start, the manager warns that the SSH server's `GatewayPorts` policy
  may expose a requested loopback listener on other interfaces.
- The SSH utility worker accepts only forwarded channels addressed to the exact
  loopback bind and assigned port. It connects them to the configured
  destination, bounds each forward to 64 open or pending connections, and
  closes paired channels/sockets on timeout, stop, transport loss or shutdown.
- Stop requests `unforwardIn`, reports stopped after bounded cleanup, and closes
  the dedicated files-only SSH runtime. No shell, PTY or SFTP subsystem is
  requested for forwarding.
- The manager identifies the direction in saved entries, endpoint labels and
  runtime status. The loopback bind address stays fixed and visible.

## Validation

Validation ran on Windows x64 with Node 24.14.1 and Electron 45:

- `corepack pnpm typecheck` passed for the TypeScript projects and tools.
- `corepack pnpm lint` passed ESLint and import-boundary checks.
- `corepack pnpm test` passed all 218 unit tests, including remote-mode validation, SQLite
  persistence, worker protocol validation, controller lifecycle, provider
  traffic/cleanup, the 64-channel rejection bound and late bind-timeout cleanup.
- `corepack pnpm build` passed the native and renderer builds. Vite reported the existing non-fatal
  renderer chunk-size warning (643.46 kB minified, above its 500 kB advisory).
- `corepack pnpm exec playwright test` passed all 16 Electron E2E scenarios.

The Windows SSH fixture exercised the tunnel manager, trusted SSH connection,
requested remote `127.0.0.1:0` bind, assigned port reporting, a full-duplex TCP
roundtrip to a local loopback service, explicit stop/unbind, restart, app
shutdown cleanup, and stopped-definition restoration. It confirmed the
server-policy warning appears before start and forwarding did not request a
shell. The remote manager was inspected at 1200×800 and
700×720; the narrow layout stacks the saved list and settings area and keeps
the form scrollable. After adding the narrow capture and endpoint-label
assertions, the focused remote-forward E2E passed again.

## Scope remaining

P-24 and F-006 remain partial. The app requests loopback, but SSH server policy
can broaden the actual bind despite the visible warning. This slice does not
provide a non-loopback bind control and informed-consent flow, dynamic SOCKS
forwarding, SSH jump-host chains, multi-hop trust or broad interoperability
coverage. No packaged release or signing decision is claimed.
