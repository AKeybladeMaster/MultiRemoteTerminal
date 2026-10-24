# WP-04A local SSH forwarding — Windows evidence

**Date:** 2026-10-24

**Branch:** `dev-1`
**Requirements:** F-006, F-012; P-23 (partial)

## Delivered behavior

- Save, edit, list and delete named local SSH forwards linked to saved SSH profiles.
- Bind only to `127.0.0.1`; port `0` asks Windows to choose the local port.
- Start is an explicit action. Startup uses a separate files-only SSH connection,
  follows the existing credential and host-trust flow, and requests no shell,
  PTY or SFTP subsystem.
- Forwarded TCP sockets preserve half-close semantics. The utility worker owns
  the listener, forwarded channels and cleanup; app shutdown closes active
  listeners. Saved definitions survive restart and remain stopped.
- Established forwarded sockets stay open after SSH channel setup; the bounded
  timeout applies only while opening a channel. Concurrent starts share one
  runtime, the application sets no active-tunnel count cap, and deleting an SSH
  profile is refused while one of its tunnels is starting or active.
- The renderer uses typed preload commands and receives only bounded runtime
  status; credentials remain in the existing main/worker path.

## Validation

`corepack pnpm check` passed on Windows x64 with Node 24.14.1 and Electron 45:

- TypeScript project and tool typechecks passed.
- ESLint and import-boundary checks passed.
- 213 unit tests passed, including 20 simultaneously active saved forwards,
  concurrent-start coalescing, preflight shutdown, profile-removal coordination,
  an actual occupied-port conflict, populated v1 schema upgrade, long-lived
  socket survival, cancellation, half-close response flow, loopback binding and
  listener release on stop.
- Native and renderer build passed.
- All 16 Electron E2E scenarios passed.

The forwarding E2E accepts a new SSH host key through the trust dialog, saves a
profile, creates three forwards through the UI and starts all three. It verifies
distinct assigned loopback ports, exchanges bytes through each SSH
`direct-tcpip` channel after the client half-closes, and re-probes all three
ports after the final start to prove they remain active together. It confirms
the forwarding connections requested no shell, closes the app, verifies all
listeners are released, then reopens the profile and verifies all three saved
definitions persist in the stopped state.

The tunnel manager was rendered and inspected at 1200×800 and 700×720 Electron
window sizes. The desktop layout keeps the status and primary actions visible;
the narrow layout stacks the saved list and editor and scrolls the form.
Keyboard checks verify initial focus, Shift+Tab wrap, Escape close and return
focus.

## Scope remaining

P-23/F-006 remain partial. This slice does not implement remote or dynamic
forwarding, SSH jump-host chains, public listeners, multi-hop trust or broad
interoperability. P-39 is VERIFIED: Windows E2E checks three saved forwards
active together, and the application regression starts twenty concurrently.
No packaged release or signing decision is claimed.
