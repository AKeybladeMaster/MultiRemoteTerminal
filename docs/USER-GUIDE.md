# MultiRemoteTerminal user guide

This guide covers the current Windows preview. Open **Help** in the workbench for
the same topics and a searchable keyboard reference; both are available without
an internet connection.

## Start a session

- **PowerShell, cmd, or Bash:** choose **New local terminal**, then pick a shell
  in the command palette. Bash requires a separate Git for Windows installation.
- **SSH:** choose **Connect to SSH**, enter a host and port, and provide account
  credentials when prompted. On first connection, verify the host fingerprint
  with a trusted source before accepting it. A changed fingerprint blocks the
  connection; investigate an unexpected change before continuing.
- **SFTP:** connect to a files-only SFTP session or open the remote file pane
  alongside an SSH terminal.
- **FTP or FTPS:** connect to a files-only session. FTPS uses TLS. Plain FTP is
  unencrypted and requires a warning acknowledgement for each connection.
- **Telnet:** connect only when the server requires it. Telnet is unencrypted
  and requires a warning acknowledgement for each connection.
- **RDP desktop:** choose **Connect to RDP desktop**, enter the host and port,
  then open Windows Remote Desktop. The viewer runs outside the workbench;
  Windows handles authentication, and the app cannot confirm connection state.
  Save a credential-free RDP profile to reopen the same target later.
- **VNC desktop:** choose **Connect to VNC desktop**, enter the host and port,
  then launch the installed TigerVNC viewer. The viewer runs outside the
  workbench; the app cannot confirm connection state. Encryption depends on
  the VNC server configuration. Save a credential-free VNC profile to reopen
  the same target later. TigerVNC must be installed in a standard Program Files
  location for the app to find it.

## Work with tabs

Select a tab to make its session active. Use `Ctrl+Tab` and
`Ctrl+Shift+Tab` to move between sessions. `Ctrl+W` begins closing the active
session; confirm the close if prompted. Middle-click a tab to start the same
close flow.

Right-click a terminal tab for **Copy selection**, **Clear terminal**, and
**Close terminal**. File-only SFTP and FTP tabs do not show this menu. Use the
font-size controls in the status bar to make terminal text larger or smaller.

## Save and move session folders

Choose **Save active session** and enter a name. Select the saved-session entry
to reopen it. Saved definitions stay in the
app's local data profile across restarts and Windows sign-outs. An installed
build stores data in this Windows user profile; a portable build stores it in
`MultiRemoteTerminal-data` beside the executable. The app has no separate
account sign-in, and closing a connection does not remove its saved definition.

Create folders from **Saved sessions** and search the saved-session list to find
an entry. Use the star to favorite a session. Session actions move or delete a
session; folder actions create subfolders, export, rename, move, or delete a
folder. Deletions ask for confirmation. Import or export a folder as a JSON
bundle from this area.

Automatic saving is off by default. In **Workbench settings**, enable
**Automatically save connections I open** to add successfully opened terminal
and file connections to Saved sessions. Reopening the same protocol and
settings updates the existing profile instead of adding a duplicate. Only
connection metadata is saved; credentials and terminal contents are not.
SSH connections routed through gateways and external RDP/VNC viewer launches
are not automatically saved because the workbench cannot restore or confirm
those routes.

Bundles are not encrypted. They contain connection and folder metadata such as
host names, ports, shell choices, and folder names. They do not contain
credentials, private keys, or terminal history. Protect exported files as you
would other connection configuration.

VNC profiles store only a host and port. TigerVNC handles any authentication;
the app does not save VNC credentials or report whether the viewer connected.

## Transfer files

In SFTP, use **Upload** to choose a local file or **Download** on a remote file.
The transfer view shows progress and offers cancellation and conflict actions.
FTP/FTPS sessions provide the same basic browse and transfer actions. Remote
permissions, server policy, and network interruption can prevent a transfer.

For an SFTP file, choose **Edit** to open a UTF-8 text file up to 512 KB. Make
your changes and choose **Save Changes** to write them back. The editor checks
that the remote file still matches the version you opened; if another process
changed it, the editor keeps your draft and asks you to reload before trying
again. **Reload** replaces the editor contents after you confirm discarding a
draft. Closing with unsaved changes also asks for confirmation. Binary files,
invalid UTF-8 and larger files are not opened by the text editor. Saves are
explicit. The syntax profile automatically recognizes Markdown (`.md`, `.markdown`),
Shell (`.sh`, `.bash`, `.zsh`, `.ksh`), PowerShell (`.ps1`, `.psm1`, `.psd1`, `.pssc`),
Python (`.py`, `.pyw`, `.pyi`), JavaScript/TypeScript (`.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts`), PostgreSQL-oriented SQL (`.sql`, `.pgsql`, `.psql`), TOML (`.toml`), YAML (`.yaml`, `.yml`) and JSON files; you
can choose another profile from **Syntax profile**. Colors are visual hints only:
the Markdown profile colors common headings, lists, block quotes, code, emphasis
and direct links; the TOML profile colors common keys, strings, values, comments and
table headers; the YAML profile colors common keys, scalar values, comments,
collections and block scalar text. The editor does not render, validate or execute
the file. Preview coloring is bounded, while
the full file remains editable. Autosave is not available. Files with a consistent
line-ending convention keep it when saved. Mixed line endings use the first
line-ending style found in the file.

## Use shortcuts and tools

| Keys | Action |
|---|---|
| `Ctrl+Shift+P` | Open or close the command palette |
| `Ctrl+W` or `Ctrl+Shift+W` | Start closing the active session |
| `Ctrl+Tab` | Select the next session tab |
| `Ctrl+Shift+Tab` | Select the previous session tab |
| `Ctrl+V`, `Ctrl+Shift+V`, or `Shift+Insert` | Paste clipboard text into the focused terminal |
| Left / Right, `Home` / `End` with a tab focused | Select previous/next or first/last session tab |
| Up / Down, `Home` / `End` with the tab menu focused | Move through terminal tab actions |
| `Esc` or `Tab` with a terminal tab menu open | Close the menu and return focus to its tab |
| Up / Down, `Enter`, `Esc`, `Tab` in the palette | Navigate and run commands, close the palette, or move focus between its controls |
| `Ctrl+Alt+Shift`, then an assigned key | Open macro review; choose Run to start it |
| `Tab` / `Shift+Tab` with a dialog open | Move between controls while focus stays in the dialog |
| `Esc` at an SSH host prompt | Reject the pending host key and stop the connection |
| `Tab` / `Shift+Tab` / `Esc` with Help open | Move through help controls or close the guide |

To assign a macro shortcut, press `Ctrl+Alt+Shift` with a supported key while
capturing it in the macro manager; press `Esc` to cancel capture. Macro
shortcuts open a review and do not run a macro without your explicit approval.
MultiExec likewise shows the exact line and destinations before it sends
anything. If delivery is interrupted, check each terminal before trying again.
In dialogs, `Esc` closes or cancels the current step when the flow allows it;
for an SSH host fingerprint prompt, `Esc` rejects the host and stops connecting.

Open **Port forwarding** to create or manage SSH local, remote, and SOCKS TCP
forwards. Review bind addresses and server policy before starting a forward.
For a saved SSH connection, choose **Connect through gateways** from its action
menu to route that connection through up to three saved SSH profiles.

Use **Workbench settings** in the header or command palette to control automatic
session saving, set a startup greeting, and configure terminal text colors.
The greeting supports up to 512 Unicode code points, is stored in the local app
profile, and appears below the tab bar after startup until you dismiss it. The
greeting is plain text and never runs in a terminal. Leave it blank to hide it.

The **Optional connection types** settings control whether new Telnet, FTP/FTPS,
serial, RDP, VNC, or local TFTP work can start. Saved profiles stay in the local
catalog while disabled, but cannot be reopened until you enable that type.
Connections and file sessions already open can continue and close.

The same dialog can highlight selected words in visible terminal output. Turn
on **Highlight terminal keywords**, add a rule, enter an RE2-style regular
expression such as `ERROR|WARN` or `MRT-[A-Z0-9-]+`, and choose its foreground
color. Rules are saved in your local profile and apply to open terminal panes.
Highlighting is off by default. Patterns have bounded size and use RE2 syntax;
look-around and backreferences are not supported. This colors matching output
without changing commands, ANSI sequences or terminal history. It is keyword
coloring rather than full shell syntax highlighting.

To color active Shell and PowerShell input, enable **Color Shell and PowerShell
input at prompts** in **Workbench settings**; it is off by default. Shell input
is recognized by common prompt endings; PowerShell input is recognized by the
common `PS <path>>` prompt form. Prompt matching uses visible text, so custom
prompts with that same form also match. The Shell tokenizer carries bounded lexical
colors after an unquoted trailing backslash when the next prompt ends in `>`;
PowerShell carries bounded command-position colors after an unquoted odd trailing
backtick when the next prompt is exactly `>>` and the caret is at an unambiguous
end of input. It also carries colors after selected pipeline, binary, assignment,
logical or array-separator operators at the end of a line. Continuation colors are
omitted if the caret is before remaining text or xterm's far-right cursor position makes it unclear whether
the caret is before or after the last character. This is a visual aid, not a parser:
quoted continuations, open-delimiter continuations, other PowerShell natural
continuation forms, custom prompt formats and shell-specific grammar are not
interpreted. Visible prompt text can match a custom prompt.

Use the theme button or command palette to switch between light and dark themes.

### PowerShell profile script

In **Workbench settings**, enter a script in **Saved PowerShell script** and
choose **Save changes**. The app stores up to 8,000 UTF-16 code units as local
plain text. Do not put passwords, tokens, or other secrets in this field.

The app keeps PowerShell startup at `-NoProfile`; this setting does not edit the
normal PowerShell `$PROFILE` file and does not run when the app starts or when a
terminal opens. To run the saved script, select a running local PowerShell tab,
open Settings, choose **Preview saved script**, review the exact saved text, then
choose **Run in this PowerShell session**. Run it only when PowerShell is at an
idle prompt: the script is sent as terminal input, so another foreground program
or prompt may receive it instead. Scripts run with your Windows account's normal
permissions and can change files or contact network services. This does not
apply to cmd, Bash, WSL, SSH, Telnet, or other sessions.

## Troubleshooting

- **SSH connection fails:** check the host, port, network route, server status,
  and account access. For a changed host fingerprint, verify it with the server
  administrator over a trusted channel before accepting it.
- **Bash is missing:** install Git for Windows and make its Bash executable
  available at the standard install location, then restart the app.
- **A transfer fails:** check the remote path, permissions, disk space, and
  connection state. Check whether an earlier transfer completed before retrying.
- **Portable profile cannot be created:** place the portable executable in a
  folder where your Windows account can write data, then launch it again.
- **A terminal appears stuck:** check whether the command is still running.
  `Ctrl+C` sends the terminal interrupt key. If the connection ended, open a new
  session and check whether the previous operation completed before repeating it.

Help content and searches stay on this device; the application does not send
them to an online help service. The app has no external analytics. Terminal
input goes to the local shell or remote endpoint selected for that session.
