# ADR-0028: Store custom logos as normalized PNG preference data

**Status:** Accepted for WP-07U
**Date:** 2026-10-26
**Requirements:** P-35, F-009

## Context

P-35 calls for a user-owned custom logo and a safe fallback when the selected image is missing or invalid. The renderer has no filesystem access, and an arbitrary image path must not cross IPC or be loaded directly from disk. User-selected image bytes are untrusted input and may be malformed or oversized.

## Decision

- The main process opens a native file picker restricted to PNG files. The renderer cannot supply a file path.
- Before decode, the main process bounds the source to 1 MiB and checks the PNG signature, IHDR, and dimensions (1 through 512 pixels on each side). Electron `nativeImage` decodes the bounded PNG; the app serializes it again as PNG and rejects an empty or over-512-KiB result. The normalized image contains no original path or ancillary metadata.
- A typed `branding.logo.select` reply contains only a bounded `data:image/png;base64,...` value. Main remembers the exact value selected during the current app run. Saving a changed non-null logo is allowed only when it matches that main-process selection; unchanged stored values and resetting to `null` remain allowed. A direct renderer-supplied data URL cannot bypass the picker and reach storage. The user saves or discards a selection with the other Workbench settings. Preference schema version 8 adds an optional normalized logo value; legacy versions default to no custom logo.
- The workbench displays the value only in an image element. CSP permits `data:` for images only; script, network, object, frame, and form restrictions remain in force. An absent or invalid saved value leaves the built-in wordmark in place.
- Resetting the logo stores `null`. No external package, executable, plugin, update, or background action is introduced.

Electron's pinned `nativeImage` API supports decoding PNG input and re-encoding a `NativeImage` to PNG. See the [official `nativeImage` documentation](https://www.electronjs.org/docs/latest/api/native-image).

## Consequences

- The renderer receives normalized image bytes but never a filesystem path. A bounded data URL is stored with non-secret workbench preferences; this avoids a path whose target can disappear or change after selection.
- The image value is capped at 700,000 characters; the full serialized preference row is capped at 732,768 characters. Old preference rows migrate to schema 8 without a logo.
- Only PNG is accepted in this slice. Other image formats, vector assets, and logo file references are not supported.
- Acceptance covers invalid/oversized image rejection, preference migration and persistence, app-header rendering, and reset to the built-in wordmark on Windows.
