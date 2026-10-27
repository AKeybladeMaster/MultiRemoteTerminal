# WP-01L independent review

**Reviewed range:** `9fd34a780a5390beb4e9c2430efc5bfc27ee2fac..0f8cf65`

## General review

- The initial review found a Minor caret-position issue: parsing only through the caret could miss a final backtick or treat a backtick before remaining input as final. Commit `02ba978` scans bounded current and xterm-wrapped rows and withholds continuation state when text remains or the caret position is uncertain. Unit regressions cover same-row text, wrapped-row text and the end-of-input control.
- A follow-up review identified xterm's occupied right-margin cell while delayed wrapping is pending as ambiguous through the public buffer API. The behavior is intentionally fail-closed and documented as a narrow coloring limitation; it does not change terminal input. A regression covers the occupied final cell.
- Final General review found no Critical, Important or unresolved Minor issues and assessed the work ready to merge.

## Spec

- The caret-before-suffix finding is resolved. Continuation state is carried only at an unambiguous logical input end and remains bounded to the existing renderer limits.
- Right-margin wrap-pending suppression is accepted for partial P-30 because xterm does not expose enough public state to distinguish a caret before the occupied cell from one after it. The implementation plan, architecture, security notes, user guide, ADR-0047, feature matrix and acceptance results now describe this limit consistently.
- No unrequested behavior or remaining spec mismatch was found.

## Standards

- No documented-standard breach was found. The implementation reads only xterm's parsed normal buffer, retains no command text, adds no IPC or persistence, fails closed within existing row/column bounds, and updates the relevant documentation.
- Possible baseline smell, judgement call: `highlightPowerShellInputSyntax` repeats the bounded-preview setup used by `highlightShellInputSyntax` in `packages/domain/src/text-syntax.ts`. It remains because the two wrappers feed distinct scanner/state result shapes and a generic helper would add indirection for only two call sites. No new smell was identified in the renderer fix.

## Validation evidence

The final Windows checks recorded in [WP-01L acceptance results](WP-01L-powershell-backtick-continuation-2026-10-27.md) passed: 53 focused unit tests, typecheck, lint/import-boundary checks, build, PowerShell E2E and Git Bash regression E2E. Reviewers did not rerun checks.

**Finding counts:** General: 0 unresolved; Spec: 0 unresolved, 1 documented limitation; Standards: 0 hard breaches, 1 possible smell (judgement call).
