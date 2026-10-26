# ADR-0025: Secure local-file drag/drop into remote folders

**Status:** Accepted for WP-05E (2026-10-26)

## Context

P-15 requires users to upload local files by dropping them onto the active SFTP or FTP folder. The renderer must not receive local filesystem paths, and Electron IPC cannot carry DOM `File` objects to the main process. Electron provides `webUtils.getPathForFile(file)` for use from a preload script; its security guidance recommends keeping the resolved path out of web content. See the official [webUtils API](https://www.electronjs.org/docs/latest/api/web-utils), [IPC renderer API](https://www.electronjs.org/docs/latest/api/ipc-renderer) and [context bridge guide](https://www.electronjs.org/docs/latest/api/context-bridge).

## Decision

- A sandboxed preload capture listener accepts only a trusted `drop` event whose target is the marked active remote-file folder. It reads the native `File` objects and resolves paths with `webUtils.getPathForFile`; it does not use `File.path` or expose the resolved paths to renderer code.
- A dedicated, typed preload-to-main IPC channel validates the main-frame sender, session UUID, SFTP/FTP transport, remote directory and a maximum batch size of 16 local paths. Main accepts absolute paths to regular files only.
- Main retains each path in a bounded in-memory registry behind an opaque UUID. A handle is one-use, expires after 10 minutes, and is bound to the owning WebContents, protocol, session and exact remote directory. Main clears handles on renderer destruction or process loss.
- The renderer receives only each handle, basename and byte size. It uploads files serially through the existing transfer broker and worker, which preserve the explicit conflict dialog, progress, cancellation, staging and commit behavior. The existing Upload file button remains available to keyboard users.
- A test-only preload simulation is enabled only after a main-process check succeeds in the un-packaged `MRT_E2E=1` test launch. It passes a native-backed `File` through the same path resolver and registration flow, while the unit test independently verifies that ordinary synthetic page events are rejected.

## Consequences and limitations

Local paths remain in preload, main and the existing worker boundary; they do not enter the renderer bridge or persistence. Malformed, stale, cross-window, cross-session, cross-protocol and cross-folder handles fail closed. The registry holds at most 16 unconsumed handles, and folders or unsupported virtual files are rejected. The keyboard upload action remains a fallback. The E2E test simulates the drop dispatch and does not automate dragging a file from Windows Explorer; native gesture behavior, 100 MB throughput, disconnect cleanup and broader server interoperability remain acceptance work.

## Evidence

Focused tests cover IPC payload validation, trusted-event gating, safe metadata, the 16-file bound, sender/session/transport/directory binding, one-use consumption, expiry, cleanup and broker reuse for SFTP/FTP. Windows loopback E2E verifies a native-backed dropped file reaches the remote SFTP fixture with matching bytes. See [WP-05E results](../results/WP-05E-sftp-file-drop-2026-10-26.md).
