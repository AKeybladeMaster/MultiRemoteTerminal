# WP-07U custom logo acceptance (partial)

**Requirements:** P-35; F-009 (logo portion)
**Decision:** [ADR-0028](../adr/ADR-0028-custom-logo-storage.md)

## Behavior

- Settings can select a PNG through the main-process picker capability. The main process reads at most 1 MiB, validates the PNG header and 1–512 pixel dimensions before decoding, then re-encodes it to PNG and caps the result at 512 KiB.
- Typed IPC returns a bounded PNG data URL; it never returns the image path. Workbench-preferences schema v8 stores the normalized value. Earlier preference schemas migrate with no custom logo.
- The header keeps its built-in wordmark and adds the selected image. Settings can remove the image and restore the built-in-only appearance.
- The CSP permits data URLs in `img-src` only. Scripts remain self-only and other external sources remain denied.

## Validation

- Focused unit, adapter, bridge, broker, IPC-contract and CSP tests: **113 passed, 0 failed** after review fixes. Coverage includes malformed and oversized sources, dimensions, normalization, path-free replies, schema-v7 migration, persistence, invalid preference values, selection authorization, and CSP policy.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm lint`: passed, including import-boundary checks.
- Windows x64 `corepack pnpm build`: passed. Vite reported its existing advisory for a JavaScript chunk above 500 KiB.
- `corepack pnpm setup:electron`: passed.
- Windows Electron E2E `corepack pnpm exec playwright test tests/e2e/foundation.test.ts -g "custom workbench logo"`: **1 passed**. It selects a valid PNG, verifies the preview and saved header image, restarts the app and verifies persistence, rejects malformed input without discarding the previous selection, resets to the built-in wordmark, then restarts and verifies the reset persisted.
- Reviewed the E2E Settings screenshot at `test-results/custom-logo-settings.png`.

The first E2E attempt correctly rejected the initial fixture: its IHDR CRC was valid but its IDAT CRC was not. The test now uses a generated 1×1 PNG with valid chunk CRCs; the final E2E run passes.

The independent Standards and General reviews found that a renderer could bypass the picker by submitting a forged PNG data URL directly to `preferences.save`. The main process now accepts a changed image only when it exactly matches the last bounded picker result; it still accepts the current stored value or `null`. The shared validator also checks decoded byte length and PNG IHDR dimensions before an IPC preference payload is accepted. Regression tests confirm oversized-IHDR and oversized-byte values are rejected and an unselected valid image is not persisted.

## Remaining acceptance

The E2E hook supplies a bounded absolute file path to the picker, exercising the real main-process file read and Electron `nativeImage` decode/re-encode path. It does not automate the native Windows file dialog itself, its PNG filter, or its cancellation behavior. P-35 therefore remains **PARTIAL** pending direct native-dialog acceptance. F-009 remains incomplete while profile-script controls remain open.

Direct UI automation was attempted using the installed Computer Use skill. `@oai/sky` initialized, but `list_apps` reported that its native pipe was unavailable on the initial call, a delayed retry, and a retry after kernel reset/reinitialization. No native-dialog action was attempted.

## Security and limitations

The renderer receives image bytes only, never the selected path. PNG signature, source size and dimensions are checked before native decoding; decoded dimensions and encoded output size are checked again. SVG and other image formats are rejected. The data URL is bounded and stored unencrypted as a non-secret workbench preference in the local SQLite settings row. The logo may identify the user or organization, so it remains within that local profile and is not included in saved-session exports.
