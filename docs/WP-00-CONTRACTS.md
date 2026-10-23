# WP-00 implementation contract

Requirements: WP-00; F-012; N-002, N-003, N-004, N-005, N-006, N-007, N-012 (foundation portions only).

## Owners and interfaces (before implementation)

- `domain/errors`: stable error categories with target and retryability; no framework or OS dependencies.
- `application/workbench`: `describeWorkbench(AppFacts)` returns only application name, version, platform and development stage. OS facts are injected by the main composition root. No protocol/storage interface is created before its slice.
- `contracts/commands`: one allowlisted `app.describe` request, contract version 1, UUID request ID and empty payload; strict validation of every field and response. No arbitrary IPC invocation surface.
- `preload/bridge`: `describe()` is the only renderer capability; bounded to one in-flight invocation and a 3 second wait. No Node object, raw IPC, filesystem, shell, or secret is exposed.
- `main/broker`: validates owner, main-frame identity and exact application URL before parsing and dispatching. Errors and audit records contain no user payload, exception, stack or command content. Diagnostics are disabled by default.
- `main/assets`: serves only build HTML and hashed JS/CSS assets from a fixed build root under secure `mrt://app`; strict CSP, no external subresources, navigation, permissions, downloads, child windows or webviews.
- Renderer: owns transient preview theme/loading/focus. The preview explicitly identifies sample terminal text and unavailable connections.

The description operation is synchronous and read-only with no I/O, cancellable resource, stream or worker. PTY/network/storage ownership and supervision are deferred to their independent slices. Closing the window ends this process; no provider runs at startup.

## Acceptance tests

Before expanding WP-00: strict TypeScript and import fitness checks; contract tests for valid requests and malformed/version/unknown/extra/oversized payloads; broker tests for foreign sender/frame/origin and redacted failure; asset route traversal/method tests; real Windows Electron E2E for preload, no Node, CSP injection, forbidden navigation/popups/permissions, app snapshot, keyboard focus, light/dark and 200% zoom. Feature matrix entries stay planned because no full product feature is completed by this foundation.

## Preview design

Original technical preview: slate canvas `#142231`, blue surface `#1e3144`, rule `#53697f`, foreground `#e7edf4`, blue accent `#a5c9f4`, amber focus `#f5ce85`. Segoe UI Variable for workbench chrome; Cascadia Mono/Consolas for explicitly labelled terminal sample. Compact sidebar and header, left-aligned content, no imagery or reference-product assets. Responsive single column at enlarged text sizes. This token preview is not the WP-01 product design.

No material departure from ADR-0001/0002. TypeScript 6.0.3 is selected within the verified typescript-eslint support range; no native addon/ABI dependency in WP-00. Windows 10, packaging, signing, SSH, persistence and all release gates remain unverified.
