# ADR-0045: Bounded Shell backslash continuation coloring

**Status:** Accepted for WP-01J, 2026-10-27

## Context

WP-01G through WP-01I color active Shell input and common command grammar. When Bash or Zsh receives an unquoted trailing backslash, it requests another line and commonly shows a secondary prompt ending in `>`. The submitted line is no longer the active input anchor, so wrapper and command-position context would otherwise be lost before the continuation row.

## Decision

- Keep Shell tokenization in the pure domain module. `highlightShellInputSyntax` may accept and return a small `ShellSyntaxContinuationState` with only lexical flags: command position, a fixed wrapper name, pending wrapper option/assignment value, and double-bracket test context.
- Return continuation state only when the input ends in an unquoted odd run of backslashes. Recognize the next input as a continuation only when its visible normal-buffer prompt ends in `>`; other prompt endings discard the carried state. The suffix check is heuristic and cannot distinguish a custom primary prompt ending in `>` if the Shell does not display its expected continuation prompt.
- Keep the state per `TerminalPane` in renderer memory. Before the Enter byte is sent, derive the state from xterm's bounded active-input view. Retain no submitted command text, and do not add shell hooks, process discovery, IPC commands, logging or persistence.
- Apply the state to the next active input row through the existing shared tokenizer. Clear it after an input line without a trailing continuation (including Enter on an empty continuation prompt), Ctrl+C/Ctrl+D/Ctrl+L, failed input/paste, a nonmatching prompt, disabled coloring, non-normal buffer, or pane teardown.
- Keep the current opt-in preference, xterm marker cleanup and 2,048-code-unit, 128-row and 64-decoration bounds. Serial remains excluded.

## Consequences and limits

The `env \` line followed by `git --version` preserves command and option colors across the secondary prompt. The renderer stores only small lexical flags, so command text is neither retained across the submitted line nor persisted. Continuations inside quoted strings, open quotes, command substitutions, compound blocks and custom secondary prompts are not recognized. This remains a lexical aid, not a Shell parser; P-30 and F-014 stay PARTIAL.

## Verification

See [WP-01J acceptance results](../results/WP-01J-shell-backslash-continuation-2026-10-27.md) for domain continuation-state coverage and Windows Git Bash PS2 UI evidence. Existing local/SSH/Telnet prompt and wrap checks remain in the WP-01G/WP-01H/WP-01I result records.
