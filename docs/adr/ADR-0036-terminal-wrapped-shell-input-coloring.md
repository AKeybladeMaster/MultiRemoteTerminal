# ADR-0036: Bounded coloring across wrapped shell input rows

**Status:** Accepted for WP-01H, 2026-10-27

## Context

WP-01G colors Shell tokens only on the physical xterm row where the input anchor was created. Long commands wrap at the terminal width, leaving later tokens uncolored even though they are part of the same user-entered command. P-30 needs useful coloring for wrapped input while retaining transient renderer-only state and bounded work.

## Decision

- Keep the existing prompt-recognition and xterm marker seam. An input anchor remains active across consecutive xterm rows only while each following buffer row is marked `isWrapped`; a hard line break or cursor movement that leaves this wrapped-row chain ends that anchor.
- Reconstruct the active input from the anchor row through the current cursor row using xterm cell spans. Preserve full-width spaces on intermediate wrapped rows so lexical offsets remain aligned, and split each token decoration at physical row boundaries.
- Bound each refresh to 2,048 UTF-16 code units, 128 physical rows and 64 token decorations. Input exceeding either of the first two bounds omits Shell decorations for that refresh; the decoration cap stops after 64 overlays. Continue using the existing visible normal-buffer read, theme palette and Shell tokenizer.
- Do not parse raw terminal output, alter input/output bytes, install prompt hooks, persist command text, or infer command safety. Submission, cancellation, disabled preference and teardown retain WP-01G cleanup behavior.

## Consequences and limits

Common typed commands remain colorable after terminal auto-wrap, including a token split between physical rows. The feature does not color shell continuation prompts or explicit newlines, does not identify the active shell, and remains a lexical hint rather than syntax or safety validation. A command beyond the row or code-unit limits is omitted for the refresh; a command with more than 64 token overlays may be partly colored. P-30 remains PARTIAL.

## Verification

See [WP-01H acceptance results](../results/WP-01H-wrapped-shell-input-coloring-2026-10-27.md). This decision extends the wrapped-row limitation recorded in [ADR-0024](ADR-0024-terminal-shell-prompt-coloring.md); its other limits remain in force.
