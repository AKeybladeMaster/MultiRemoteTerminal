# ADR-0044: Bounded Shell command grammar coloring

**Status:** Accepted for WP-01I, 2026-10-27

## Context

WP-01G and WP-01H add opt-in colors for tokens already visible in xterm's active input row. The shared Shell tokenizer currently colors all command-position words alike and loses command-position context after wrappers such as `sudo`, `env` or `command`. P-30 asks for readable command input across local, SSH and Telnet terminals while prohibiting shell hooks, input rewriting and command execution by the colorizer.

## Decision

- Keep lexical classification in the existing pure domain `text-syntax` module so editor previews and terminal prompt decorations use the same token ranges.
- Distinguish a fixed common Bash/Zsh builtin set from other command-position words. Use the existing semantic palette with a separate green builtin role; preserve the command color for external and unresolved command words.
- Recognize common `[[`, `]]`, `!` and `time` reserved markers and carry command-position state through a fixed set of common wrappers: `builtin`, `command`, `doas`, `env`, `exec`, `nice`, `nohup` and `sudo`. Consume option values only for the explicit option forms listed by that scanner. Keep assignment prefixes visible as variable tokens while awaiting the wrapped command.
- Do not discover the active shell, inspect `PATH`, execute candidate commands, read prompt escape sequences, add shell startup hooks or change terminal bytes. The feature remains opt-in and retains the input-size, row-count, token and decoration bounds.
- Keep the token-coloring interface as a bounded text-to-token function. Do not add a process or adapter seam for shell discovery because no production shell integration is required.

## Consequences and limits

Common builtins and command chains such as `sudo -u user env NAME=value git status` receive more useful colors in Shell editor previews and active prompt input. This is still a lexical subset, not a parser or proof of what the active shell will execute. The builtin list is fixed and can differ from an installed shell version; functions, aliases, shell-specific options, heredoc bodies and continuation-line state are not resolved. A command wrapper or option not in the fixed lists can be colored imperfectly. No command is run to validate a name. Prompt-color state and text remain transient; P-30/F-014 stay PARTIAL.

## Verification

See [WP-01I results](../results/WP-01I-shell-command-grammar-coloring-2026-10-27.md) for pure-domain token coverage and Windows Git Bash/SSH/Telnet UI evidence.
