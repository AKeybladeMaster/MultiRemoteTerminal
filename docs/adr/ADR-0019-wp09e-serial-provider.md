# ADR-0019: Windows serial provider in a utility worker

**Status:** Accepted for WP-09E, 2026-10-25

## Context

F-016 requires COM-port enumeration and serial terminal settings. Windows serial access needs a native binding, while the product architecture keeps Electron, Node and protocol libraries outside domain/application logic and prevents the renderer from accessing ports or secrets. Opening a port can send bytes to a connected device, so it must follow an explicit user action.

## Decision

- Use exact-pinned `@serialport/stream@13.0.0` and `@serialport/bindings-cpp@13.0.1`. Keep both out of domain, application, contracts, renderer, preload and main-process modules; load them only in a supervised Electron utility worker.
- Expose COM port listing, open, write, resize, output acknowledgement, close and shutdown through strict versioned worker messages and allowlisted typed renderer IPC. Canonicalize paths to `COM1`–`COM4095`; accept only bounded baud, data-bit, parity, stop-bit and flow-control settings.
- Start the worker only when a user requests the port list or explicitly opens a port. Opening never executes a command. The UI displays serial output through xterm as UTF-8 terminal text.
- Cap each input request at 1,024 UTF-16 code units and queue size at the existing terminal bound. Bound output chunks, unacknowledged bytes, active sessions, open/close waits, and write waits derived from line rate. Close and worker shutdown invalidate sessions and release the port.
- Use `@serialport/binding-mock@10.2.2` only as a development dependency for worker and Windows E2E evidence. Its test-only mode requires an unpackaged app, `MRT_E2E=1`, and an explicit test argument; it cannot be enabled in a packaged app.
- Do not persist serial definitions in this slice. Profile/catalog/bundle support is a separate migration and acceptance phase.

## Consequences

The provider depends on the installed Windows COM driver and the native binding's packaged prebuild. A Windows mock verifies that the native module loads inside the pinned Electron utility process, but it does not verify a physical UART/USB adapter, serial-number redaction in every driver, device-specific encoding, hot-unplug recovery, or driver-signature policy. Device bytes are potentially sensitive and may be commands; neither input nor output is logged. Utility process isolation limits the location of native state but is not a security sandbox.

## Verification

See [WP-09E acceptance evidence](../results/WP-09E-serial-2026-10-25.md) and [dependency review](../dependencies/WP-09E-serialport.md).
