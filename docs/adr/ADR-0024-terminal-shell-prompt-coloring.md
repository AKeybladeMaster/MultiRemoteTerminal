# ADR-0024: Opt-in terminal shell prompt coloring

**Status:** Accepted for WP-01G, 2026-10-26

## Context

P-30 asks for readable syntax colors in terminal sessions. WP-01F already colors configured keywords in xterm's visible parsed output, and WP-08E supplies a pure bounded Shell tokenizer for editor previews. A terminal does not expose a structured command model, and changing raw terminal bytes or adding shell startup hooks could change protocol behavior or execute user code.

## Decision

- Add a persistent workbench preference, `terminalShellSyntaxEnabled`, defaulting to `false`. Advance the preference schema to v4; valid v1 greeting, v2 keyword-highlight and v3 automatic-session-save settings migrate with shell coloring disabled.
- On local, SSH and Telnet terminals, observe only the normal xterm buffer. When a user keystroke first arrives and the visible cursor-line text ends in a common prompt character (`$`, `#`, `%` or `>`), retain an xterm marker and cursor column as a transient anchor. Color only the typed portion of that active physical row with token ranges from the shared Shell tokenizer.
- Reuse the current terminal theme's foreground colors. Apply no more than 64 token decorations during a refresh and retain the existing 2,048 UTF-16 code-unit line extraction bound. Do not parse raw output, add protocol messages, rewrite terminal bytes, log command text or persist token state.
- Clear the marker on Enter, Ctrl+C, Ctrl+D, Ctrl+L, failed clipboard paste and terminal-pane teardown. Exclude serial terminals.
- Keep the user in control of the feature through the Settings checkbox. Do not install shell scripts, change prompt configuration, infer command safety or enable coloring by default.

## Consequences and limits

The colors provide a bounded lexical aid for text currently visible in the active input row. Prompt recognition is intentionally simple and accepts only the final `$`, `#`, `%` or `>` character; it does not identify the shell or prove that a prompt is safe. Wrapped command lines, continuation prompts, full zsh grammar and shell-specific semantic checks are not supported. The tokenizer may color a token differently from the shell's eventual interpretation. With coloring disabled, the renderer does not install the shell token decoration path.

The marker, anchor and decorations exist only in renderer memory and follow xterm buffer movement. No terminal input or output value is added to storage or logging. The shell and remote peer retain their existing authority over command execution; this feature makes no command safe to run.

## Verification

See [WP-01G acceptance results](../results/WP-01G-terminal-shell-prompt-coloring-2026-10-26.md). P-30 remains PARTIAL until broader shell-aware syntax behavior and the documented terminal acceptance are completed.
