# Domain glossary

Use these terms consistently in specs, issue titles, test names and interfaces.

- **Session definition:** saved configuration for a connection or local shell. Unlimited in count; never a live socket.
- **Runtime session:** a live process/protocol connection with state and cleanup ownership.
- **SSH session log:** a user-selected local plain-text record of one SSH connection attempt/session lifecycle and terminal input/output; sensitive, bounded and never an audit/compliance record.
- **Tab / pane:** view presentation of a runtime session; closing a tab requests controlled runtime disposal.
- **Provider:** installed or built-in implementation for a protocol/capability, exposed through a module interface.
- **Capability:** supported action (shell, file-browser, forward, desktop, serial, daemon) advertised by a provider.
- **Jump host / gateway:** intermediate SSH endpoint with independent trust and credentials.
- **Tunnel:** user-defined local, remote or dynamic port-forwarding rule, plus optionally a live instance.
- **Transfer job:** cancellable SFTP upload/download with persistent metadata and optional progress.
- **Macro:** typed sequence of terminal input/wait/confirmation steps. Not a privileged JS program.
- **MultiExec:** opt-in fanout of user input to selected runtime sessions with per-target result.
- **Host trust decision:** explicit accept/reject after SSH host fingerprint inspection.
- **Vault:** module that encrypts/decrypts credentials for an operation without returning them to the renderer.
- **Profile script:** explicitly configured and previewable shell initialization text/path; an executable local file, not a hidden app startup action.
- **Tool registry:** an allowlist/catalog of supported local providers and built-in actions with user settings for visibility/availability. WP-11A's fixed local-shell catalog controls command-palette visibility; WP-11D separately controls whether each shell can start or reopen a session. Neither setting detects installation or accepts arbitrary executable paths.
- **Daemon:** intentionally started background server with a monitored lifecycle and no app-enforced time limit.
- **Modular monolith:** one local desktop product with cohesive domain/application modules, sometimes internally split into utility processes for safety and responsiveness.
- **Deep module:** substantial behavior behind a small coherent interface. See codebase-design skill.
- **Seam:** place where one adapter can be changed without changing caller behavior.
- **Full feature parity:** user-visible feature works in a live protocol test. Mere UI placeholder, external launcher without disclosure, or stub is not parity.
- **REA evidence:** observed product behavior linked to exact target version, test action, result and confidence; never reusable proprietary implementation.
