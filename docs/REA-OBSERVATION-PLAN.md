# REA Reference-Behavior Observation Plan

**Purpose:** Resolve *observable user-facing behavior* not made precise by official documentation. This is a research plan, not reverse-engineering evidence or a claim that REA ran.

## Prerequisites

1. User has lawful access to an installed reference version and accepts its terms.
2. Inspect the **locally installed** `C:\Users\Beasty\.agents\skills\reverse-engineer-anything\SKILL.md` to learn the available workflow. Do not assume the `morluto/rea` skill installation also installed or connected the REA MCP runtime.
3. Verify actual REA tools. Choose native artifact analysis only where specifically needed; prefer **public documentation and passive UI observation** for functional requirements.
4. Record version/build identifier, source file hash where applicable, Windows version, observation date, target and session setup. Never post credentials, captured server secrets or proprietary code.

## Research backlog

| Evidence ID | Question | Permitted observation | Output needed |
|---|---|---|---|
| REA-01 | Session-definition UX | Create two sessions and inspect visible fields | Field list and flow; no copied internal storage |
| REA-02 | SSH first-use host trust | Connect to controlled host | Dialog information and error flow |
| REA-03 | SFTP auto-pane | SSH with and without SFTP enabled | Trigger and fallback behavior |
| REA-04 | Forwarding | Create L/R/D tunnels to test host | Necessary fields/status/stop behavior |
| REA-05 | Macro UX | Record harmless `echo` and replay | User-visible steps, dialogs, cancellation |
| REA-06 | X11 startup | Connect to lab X11-enabled SSH host | App-visible provider state and DISPLAY negotiation |
| REA-07 | Professional appearance | View officially documented customizer output | Configuration outcomes, not branded assets or binaries |
| REA-08 | RDP/VNC launch | Connect to lab remote desktops | User-level workflow and options |
| REA-09 | Daemon lifecycle | Run harmless loopback TFTP/cron in licensed context | Visible start/stop/status; no edition-limit bypass |
| REA-10 | Connection failure modes | Drop network to lab host | Visible error, retry and cleanup behavior |

## Evidence ledger (blank template)

An initial, static-only archive inventory is now recorded in [REA-00](evidence/REA-00-archive-inventory.md).
REA-01 through REA-10 remain unobserved. The executable has not been run, decompiled or reused.

| ID | Reference version | Test setup | Step | Observed result | Evidence locator | Confidence | Unknowns |
|---|---|---|---|---|---|---|---|
| REA-TEMPLATE | TBD | Controlled test | TBD | TBD | TBD | Low/Med/High | TBD |

Do not turn hypothesis into measured fact. Distinguish UI inference, protocol trace, static metadata and verified runtime evidence. A negative search has a bounded scope and should not be presented as exhaustive.

## Independent design output format

For each observation, produce:

- Reference user intent and behavior (no source/executable assets).
- MultiRemoteTerminal *independent design* decision and requirement ID.
- Privacy/security risks and UX accessibility adjustments.
- Test case that reproduces the desired outcome in our own program.
- Open questions and confidence.

## Explicit prohibitions

- No cracking, patching, unlocking, resetting, or circumventing reference application license/edition restrictions.
- No proprietary source, decompiled algorithm translation, firmware extraction for copying, artwork, embedded assets, internal scripts or exact look-and-feel reproduction.
- Do not use credentials other than controlled lab accounts or inspect someone else's live sessions.
- No bundled reverse-engineered third-party binaries in MultiRemoteTerminal.

**REA is optional for implementation:** The official edition/features pages already ground the top-level requirements. A team can implement the MVP from this specification without binary analysis and use REA later for narrow behavior questions.
