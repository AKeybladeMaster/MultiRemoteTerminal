# WP-04B loopback remote SSH forwarding — Windows evidence

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

`corepack pnpm check` passed on Windows x64 with Node 24.14.1 and Electron 45:

- TypeScript project and tool typechecks passed.
- ESLint and import-boundary checks passed.
- All 216 unit tests passed, including remote-mode validation, SQLite
  persistence, worker protocol validation, controller lifecycle and provider
  traffic/cleanup.
- Native and renderer build passed. Vite reported the existing non-fatal
  renderer chunk-size warning (643.03 kB minified, above its 500 kB advisory).
- All 16 Electron E2E scenarios passed.

The Windows SSH fixture exercised the tunnel manager, trusted SSH connection,
requested remote `127.0.0.1:0` bind, assigned port reporting, a full-duplex TCP
roundtrip to a local loopback service, explicit stop/unbind, restart, app
shutdown cleanup, and stopped-definition restoration. It confirmed forwarding
did not request a shell. The remote manager was inspected at 1200×800 and
700×720; the narrow layout stacks the saved list and settings area and keeps
the form scrollable. After adding the narrow capture and endpoint-label
assertions, the focused remote-forward E2E passed again.

## Scope remaining

P-24 and F-006 remain partial. This slice requests loopback only, and server
configuration determines whether that request is honored as expected. It does
not provide non-loopback bind consent, dynamic SOCKS forwarding, SSH jump-host
chains, multi-hop trust or broad interoperability coverage. No packaged release
or signing decision is claimed.
