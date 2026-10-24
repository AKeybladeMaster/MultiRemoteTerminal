# WP-09B — Warning-gated Telnet terminal

**Date:** 2026-10-24  
**Requirements:** P-04, F-019 (Telnet portion); WP-09 overall remains incomplete.  
**Status:** P-04 verified by Windows loopback acceptance; other WP-09 protocols remain planned.

## Behavior

The workbench can open interactive Telnet terminals by host and port. A visible plaintext warning explains that Telnet traffic, including anything typed at the remote prompt, is unencrypted and may expose secrets. The Connect button remains disabled until the user acknowledges the warning. Consent is reset on every new connection and every saved-profile reopen. Telnet sessions are visibly labeled `Telnet (plaintext)`; the app does not collect or store a Telnet username, password, terminal transcript or command history.

Telnet profiles persist only the canonical host, port and ordinary saved-session metadata. A saved profile opens the same warning dialog with the endpoint prefilled. The terminal supports keyboard input, explicit clipboard paste through the existing trusted gesture flow, output, resize notifications, close and normal tab lifecycle.

## Architecture decisions

- Use Node's built-in `node:net`; no dependency was added.
- Keep TCP and Telnet framing in an Electron utility process. The application owns session lifecycle through `TelnetTerminalController`; the main process exposes only validated `telnet.*` commands through the existing broker and preload boundary.
- The codec incrementally parses IAC commands, bounds subnegotiation to 512 bytes, and supports BINARY, Suppress Go Ahead, remote ECHO, NAWS and terminal type `XTERM-256COLOR`. It applies NVT CR/LF rules until BINARY is accepted, escapes IAC bytes, and suppresses duplicate NAWS/terminal-type replies to prevent negotiation amplification.
- Bound connect time to 12 seconds, worker open to 15 seconds, preload open IPC to 20 seconds, queued terminal input, output event size and unacknowledged output. Close, timeout, worker crash and app shutdown destroy the socket and settle pending operations.
- The provider is unencrypted by design. Use it only where plaintext Telnet is necessary, never for secrets or untrusted networks.

## Validation

- `corepack pnpm check` — passed on Windows x64: typecheck, ESLint and import-boundary checks; 139 unit tests; production build; all 13 Windows Electron E2E tests.
- `corepack pnpm exec playwright test -g "Telnet requires plaintext consent"` — passed separately. The loopback test verifies that consent is required initially and on saved-profile reopen, that the real utility-worker path negotiates TCP Telnet options, that terminal input reaches the server, and that server output renders in the terminal.
- Unit coverage includes fragmented Telnet framing, bounded subnegotiation, duplicate-negotiation suppression, NVT/BINARY input, canonical endpoints, worker crash settlement, exact worker/IPC shapes, and loopback provider open/write/resize/output/ack/close.
- `corepack pnpm build` succeeds with the existing Vite advisory that the renderer chunk exceeds 500 kB minified; native build and packaging are otherwise successful in this check.

## Limitations

The TCP E2E uses an in-process loopback server and exercises the implemented negotiation; it does not certify interoperability with every historic Telnet daemon or vendor-specific option. Terminal type is currently fixed to `XTERM-256COLOR`. Telnet has no encryption, so the warning cannot make it suitable for credentials or sensitive traffic. FTP, Rlogin/RSH, Mosh and serial support remain separate WP-09 work.
