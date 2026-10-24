# WP-02 SSH flow visual targets

These generated targets extend the approved WP-01 workbench identity. They define layout and visual hierarchy only; product behavior comes from the WP-02 acceptance contract and ADR-0003.

- [Quick connect target](WP-02-ssh-quick-connect-target.png), 1550 × 1014 pixels. Shows a centered “Connect to SSH” dialog with host and port only. Credentials are entered through the native Windows prompt after the explicit Connect action.
- [Unknown host target](WP-02-ssh-host-trust-target.png), 1551 × 1014 pixels. Shows the blocking host-key decision with an illustrative endpoint and fingerprint. The fingerprint text is selectable; the target does not add a clipboard action. “Reject” is visibly focused to make the fail-closed path clear.

Both targets preserve the dark slate workbench, compact session rail, Segoe UI controls, Cascadia Mono terminal and amber focus ring. Any implementation must keep endpoints and fingerprints visibly dynamic, must not represent the illustrative example fingerprint as live evidence, and must expose both dialogs to keyboard and assistive-technology users.
