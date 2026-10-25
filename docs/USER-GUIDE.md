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

Bundles are not encrypted. They contain connection and folder metadata such as
host names, ports, shell choices, and folder names. They do not contain
credentials, private keys, or terminal history. Protect exported files as you
would other connection configuration.

## Transfer files

In SFTP, use **Upload** to choose a local file or **Download** on a remote file.
The transfer view shows progress and offers cancellation and conflict actions.
FTP/FTPS sessions provide the same basic browse and transfer actions. Remote
permissions, server policy, and network interruption can prevent a transfer.

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
menu to route that connection through up to two saved SSH profiles.

Use **Workbench settings** in the header or command palette to set a startup
greeting. It supports up to 512 Unicode code points, is stored in the local app
profile, and appears below the tab bar after startup until you dismiss it. The
greeting is plain text and never runs in a terminal. Leave it blank to hide it.

Use the theme button or command palette to switch between light and dark themes.

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
