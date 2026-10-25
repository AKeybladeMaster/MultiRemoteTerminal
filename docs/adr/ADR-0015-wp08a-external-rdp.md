# ADR-0015: External Windows RDP launch

**Status:** Accepted for WP-08A (2026-10-25)

## Context

Requirement F-015 calls for RDP desktop sessions. The first WP-08 milestone specifies an external Windows viewer and explicitly forbids presenting it as an embedded desktop. Existing SQLite schema already permits `rdp` session definitions. The app must keep renderer capabilities narrow, avoid storing remote credentials, and distinguish a process launch from a successful network session.

## Decision

- Add a domain-validated RDP endpoint, an application `RdpViewerController`, and one fixed `rdp.launch` request/reply through the typed preload bridge.
- The Windows adapter resolves `mstsc.exe` from the native System32 directory and starts it with `/v:<host>:<port>` using an argument array, `shell: false`, a hidden window, and a detached process. IPv6 endpoints are bracketed. No user-selected executable, command string, credentials, or `.rdp` file crosses IPC.
- Launch requires a fresh, one-shot trusted click on the RDP dialog's launch button. The preload binds that click to the canonical host and port, and the main broker consumes the sender-scoped authorization before process launch; direct bridge or broker calls fail closed. The UI states that Windows handles authentication, the viewer is external, and the app cannot confirm connection state. Saved RDP profiles contain only their name and canonical endpoint.
- A bounded five-second startup wait reports success only after Node observes the process `spawn` event. Timeout and caller cancellation settle the request; before ownership transfers to Windows, cancellation/timeout kills the child. The app does not own or terminate the external viewer after it starts.
- Version-4 saved-folder bundles add RDP profiles; versions 1 through 3 remain importable with their prior session-kind limits. No database schema migration or package dependency is needed.

## Consequences

The external provider classification is visible in saved profile labels and user-facing copy. A successful app result means only that Windows Remote Desktop started; it does not prove that the remote endpoint accepted a connection, that authentication succeeded, or that a desktop is visible. Windows network interoperability and credential behavior still require a real RDP fixture before P-07 can be verified.

The main process starts only a fixed OS binary from System32. It does not implement RDP networking or pass credentials to the viewer. A future VNC provider must receive its own dependency, integrity, license, and capability review rather than reuse this launcher blindly.

## Evidence

`tests/unit/rdp-viewer.test.ts` covers endpoint validation, IPv6 target formatting, exact System32 process arguments, shell-free launch, platform/error categories, and cancellation cleanup. Gesture-gate, preload, contract, broker, SQLite, and bundle tests cover explicit launch authorization, the typed handoff, and persisted profile roundtrip. The Windows UI E2E uses a test-only fake provider to verify profile persistence, direct-bridge rejection without a trusted click, and the explicit external-launch workflow. P-07 remains PARTIAL until an actual RDP connection is verified against a test server.
