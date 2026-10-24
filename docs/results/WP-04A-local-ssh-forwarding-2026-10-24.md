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
- The renderer uses typed preload commands and receives only bounded runtime
  status; credentials remain in the existing main/worker path.

## Validation

`corepack pnpm check` passed on Windows x64 with Node 24.14.1 and Electron 45:

- TypeScript project and tool typechecks passed.
- ESLint and import-boundary checks passed.
- 205 unit tests passed, including tunnel validation, more-than-two SQLite
  definitions, bind conflict cleanup, cancellation, half-close response flow,
  loopback binding and listener release on stop.
- Native and renderer build passed.
- All 16 Electron E2E scenarios passed.

The forwarding E2E accepts a new SSH host key through the trust dialog, saves a
profile, creates and starts a forward through the UI, verifies its assigned
loopback port, exchanges bytes through an SSH `direct-tcpip` channel after the
client half-closes, and confirms the forwarding connection requested no shell.
It closes the app while the tunnel is active, confirms that the listener is
released, then reopens the same profile and verifies both the saved SSH profile
and stopped tunnel definition persist.

The tunnel manager was rendered and inspected at 1200×800 and 700×720 Electron
window sizes. The desktop layout keeps the status and primary actions visible;
the narrow layout stacks the saved list and editor and scrolls the form.
Keyboard checks verify initial focus, Shift+Tab wrap, Escape close and return
focus.

## Scope remaining

P-23/F-006 remain partial. This slice does not implement remote or dynamic
forwarding, SSH jump-host chains, public listeners, multi-hop trust or broad
interoperability. P-39 remains planned: the catalog test stores three
definitions, but the full 20-definition and multiple-active-runtime acceptance
has not been completed. No packaged release or signing decision is claimed.
