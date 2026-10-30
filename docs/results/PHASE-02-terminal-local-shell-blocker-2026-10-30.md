# Phase 02 — terminal and local shell blocker

**Status:** BLOCKED; implementation and phase verification are not complete.
**Requirements:** F-002, P-01, P-02, P-21, P-30, N-001, N-006, N-008.
**Development head inspected:** `811701c230e4f0c953ce58dbf907afc3f3d7ecc3` on `dev-1`.

## Existing implementation and evidence

- P-01 remains VERIFIED by [WP-01 evidence](WP-01-2026-10-23.md), which covers ten local terminal tabs, shell commands, resizing, keyboard navigation, both themes and 200% device scale.
- WP-01 through WP-01N and WP-11A/B/D provide the existing local terminal, shell catalog, bounded prompt coloring, optional shell availability and explicit WSL selection work. Those accepted slices were not reimplemented here.
- F-002/P-02 remain PARTIAL. The latest Windows 11 Git Bash resize evidence records 19 passes and six first-character losses in 25 runs; the focused acceptance E2E remains explicitly skipped. The paste path also lost the first character in eight of 20 diagnostic runs. See [WP-01E resize evidence](WP-01E-local-resize-2026-10-29.md).
- Real user-distribution WSL interoperability, wider Bash/Zsh/PowerShell behavior, full shell-coloring grammar, a dedicated 200% accessibility review and N-008's p95 typing measurement with ten idle tabs remain unverified.

## Diagnosis

Static inspection confirms that renderer input is ordered behind local resize replies, the preload tracks pending local writes and pastes, and the utility worker calls `node-pty` resize before replying. That reply does not establish that ConPTY or the child shell has processed the resize and redrawn its prompt.

Microsoft documents `ResizePseudoConsole` as resizing the pseudoconsole buffers. Microsoft Terminal's maintainers explain that ConPTY may finish rendering a prior frame before rendering the resized contents; the discussion gives no child-process acknowledgement mechanism. The pinned `node-pty` API exposes synchronous `resize()` and no completion event. See [ResizePseudoConsole](https://learn.microsoft.com/windows/console/resizepseudoconsole), [Microsoft Terminal resize discussion](https://github.com/microsoft/terminal/issues/1156), and the [node-pty resize implementation](https://github.com/microsoft/node-pty/blob/v1.1.0/src/win/conpty.cc).

Existing diagnostics tested resize suppression, WinPTY, disabling cursor inheritance, removing per-key fit, 250/500 ms delays, disabling Bash Readline, bundled ConPTY, a `node-pty` prerelease, and typed versus clipboard input. None produced reliable acceptance. Replaying a possibly delivered keystroke risks duplicate shell commands; sending a synthetic control byte can corrupt input to programs that are not at a shell prompt. Neither is an acceptable workaround.

## Disposition

No Phase 02 implementation changes were made on this turn. The Phase 04 repository-wide gate did run terminal E2Es; the Git Bash first-input-after-resize case remained an explicit skip. Those suite results do not close the Phase 02 requirement, and the phase-specific verification remains deferred until its implementation work is complete.

The immediate resize/input gate cannot be closed safely with the available API evidence. Keep F-002 and P-02 PARTIAL and Phase 02 BLOCKED. Revisit this work when a reliable child-redraw boundary or a separately validated platform/upstream fix is available. Continue independent work in Phase 03; do not promote an incomplete Phase 02 candidate to `main`.
