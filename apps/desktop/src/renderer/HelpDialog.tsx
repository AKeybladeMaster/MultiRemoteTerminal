import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

interface HelpTopic {
  readonly title: string;
  readonly body: string;
  readonly keywords: readonly string[];
}

interface HelpSection {
  readonly id: string;
  readonly title: string;
  readonly topics: readonly HelpTopic[];
}

interface KeyboardShortcut {
  readonly keys: string;
  readonly action: string;
}

const HELP_SECTIONS: readonly HelpSection[] = [
  {
    id: 'connections',
    title: 'Open a connection',
    topics: [
      { title: 'Local terminals', body: 'Choose New local terminal, then select PowerShell, cmd, or Bash in the command palette. Workbench Settings lets you show or hide each shell action. Hiding an action does not uninstall the shell or affect saved sessions. Bash uses an installed Git for Windows runtime; the app does not install or bundle it.', keywords: ['shell', 'powershell', 'cmd', 'bash', 'git', 'settings', 'visibility'] },
      { title: 'SSH terminals', body: 'Enter the server name and port. On first connection, compare the displayed host fingerprint with a value from a trusted source before accepting it. A changed host key blocks the connection until you investigate it. From a saved SSH session menu, choose Connect through gateways to route this connection through up to two saved SSH profiles.', keywords: ['ssh', 'remote', 'host', 'fingerprint', 'key', 'trust', 'gateway', 'jump host'] },
      { title: 'SFTP files', body: 'Connect to SFTP for a files-only session, or open the file pane beside an SSH terminal. Browse folders and use the transfer controls to upload or download files.', keywords: ['sftp', 'files', 'upload', 'download', 'ssh'] },
      { title: 'FTP, FTPS, and Telnet', body: 'FTPS protects the FTP connection with TLS. Plain FTP and Telnet are unencrypted; the app shows a warning and requires your confirmation for each connection.', keywords: ['ftp', 'ftps', 'telnet', 'plaintext', 'unencrypted', 'tls', 'warning'] },
      { title: 'RDP desktop', body: 'Choose Connect to RDP desktop, enter a host and port, then open Windows Remote Desktop. The viewer runs outside the workbench. Windows handles authentication; the app does not store RDP credentials or track connection state. Saved RDP profiles contain only the target and profile name.', keywords: ['rdp', 'remote desktop', 'mstsc', 'external viewer', 'credential'] },
      { title: 'VNC desktop', body: 'Choose Connect to VNC desktop, enter a host and port, then open TigerVNC. Install TigerVNC under Program Files first. It runs outside the workbench and handles authentication; the app saves only the target and profile name. VNC security and encryption depend on the server configuration.', keywords: ['vnc', 'tigervnc', 'remote desktop', 'external viewer', 'credential', 'encryption', 'security'] }
    ]
  },
  {
    id: 'sessions',
    title: 'Saved sessions and folders',
    topics: [
      { title: 'Save and reopen', body: 'Use Save active session, then give the connection a name. Select its entry in Saved sessions to reopen it. Saved definitions stay in the app data profile across restarts and Windows sign-outs. An installed build stores data in this Windows user profile; a portable build stores it in MultiRemoteTerminal-data beside the executable. There is no separate account sign-in, and closing a connection or the app does not remove a saved definition. They store connection settings, not credentials or terminal history.', keywords: ['save', 'reopen', 'persist', 'profile', 'logout', 'sign out', 'history', 'portable'] },
      { title: 'Organize folders', body: 'Search the Saved sessions list and use the star to favorite a saved session. Use session actions to move or delete it. Folder actions let you create a subfolder, export, rename, move, or delete a folder. Deletions ask for confirmation.', keywords: ['folder', 'organize', 'move', 'favorite', 'rename', 'delete', 'search'] },
      { title: 'Import and export', body: 'Import or export a folder as a JSON bundle from Saved sessions. Bundles are not encrypted and include connection metadata such as host names, ports, and folder names. They do not include credentials, private keys, or terminal history. Store exported files carefully.', keywords: ['json', 'bundle', 'import', 'export', 'backup', 'credential', 'secret'] }
    ]
  },
  {
    id: 'terminal',
    title: 'Terminal controls',
    topics: [
      { title: 'Switch or close tabs', body: 'Select a tab, use the keyboard shortcuts below, or focus the tab strip and move with the arrow and Home/End keys. Middle-click a terminal tab to begin closing it. Closing a running terminal asks for confirmation.', keywords: ['tab', 'switch', 'close', 'middle click', 'mousewheel'] },
      { title: 'Terminal tab menu', body: 'Right-click a terminal tab for Copy selection, Clear terminal, and Close terminal. This menu is available on terminal tabs; file-only tabs do not show it.', keywords: ['right click', 'context menu', 'copy', 'clear', 'selection'] },
      { title: 'Paste and font size', body: 'Paste into a terminal with Ctrl+V, Ctrl+Shift+V, or Shift+Insert after focusing it. Multi-line paste asks you to confirm before sending. Use the font-size controls in the status bar to adjust terminal text.', keywords: ['clipboard', 'paste', 'shift insert', 'multiline', 'font', 'zoom'] },
      { title: 'Keyboard use in dialogs', body: 'Use Tab and Shift+Tab to move through controls in an open dialog. Escape closes or cancels the current dialog when allowed. In SSH host verification, Escape rejects the pending host key and connection.', keywords: ['keyboard', 'dialog', 'tab', 'shift tab', 'escape', 'host trust', 'reject'] },
      { title: 'Theme', body: 'Use the header button or command palette to switch between the light and dark workbench themes.', keywords: ['theme', 'light', 'dark', 'appearance', 'color'] }
    ]
  },
  {
    id: 'files',
    title: 'Files and transfers',
    topics: [
      { title: 'SFTP transfers', body: 'Open the remote file pane from a running SSH terminal, or connect to SFTP directly. Select a file and choose Download; use Upload to send a local file. The transfer panel shows progress and offers cancellation and conflict choices.', keywords: ['sftp', 'transfer', 'upload', 'download', 'progress', 'cancel', 'overwrite'] },
      { title: 'FTP and FTPS transfers', body: 'Connect to a files-only FTP or FTPS session, browse the remote directory, and use its upload and download controls. Choose the secure FTPS mode when the server supports it.', keywords: ['ftp', 'ftps', 'files', 'transfer', 'directory'] }
    ]
  },
  {
    id: 'tools',
    title: 'Macros and port forwarding',
    topics: [
      { title: 'Macros', body: 'Create or record a macro, review its steps and target, then choose Run to send it. To assign a shortcut, press Ctrl+Alt+Shift with a supported key; press Escape to cancel capture. A saved shortcut opens review and never runs the macro without your approval. Recording omits clipboard paste and pauses on recognized secret prompts.', keywords: ['macro', 'record', 'playback', 'shortcut', 'run', 'secret', 'escape', 'cancel'] },
      { title: 'MultiExec', body: 'Select active terminals, enter one line, review the exact text and destinations, then confirm once to send. Delivery can be uncertain if a connection drops during the write; inspect each terminal before retrying.', keywords: ['multiexec', 'multi-exec', 'broadcast', 'send', 'review', 'commands'] },
      { title: 'SSH port forwarding', body: 'Open Port forwarding to define and manage local, remote, or SOCKS forwarding through a saved SSH profile. Current SOCKS support is TCP CONNECT. Review bind addresses and the SSH server policy before starting a forward.', keywords: ['tunnel', 'port', 'forwarding', 'socks', 'gateway', 'ssh'] }
    ]
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    topics: [
      { title: 'SSH was rejected or the host changed', body: 'Check the host name, port, network route, and server availability. If the fingerprint changed, stop and verify the new fingerprint with the server administrator over a trusted channel; do not accept an unexplained change.', keywords: ['ssh', 'host key', 'fingerprint', 'rejected', 'timeout', 'connection'] },
      { title: 'Bash is unavailable', body: 'Install Git for Windows and make sure its Bash executable is available at the standard install location, then restart the app and try again. Bash is an optional user-installed runtime.', keywords: ['bash', 'missing', 'git', 'shell', 'not found'] },
      { title: 'A file transfer failed', body: 'Check the remote path, account permissions, available disk space, and connection state. For a name conflict, select an offered conflict action and retry only after checking whether the earlier transfer completed.', keywords: ['file', 'transfer', 'upload', 'download', 'permission', 'cancel', 'conflict'] },
      { title: 'Portable data could not be created', body: 'The portable profile lives beside the portable executable. Move the executable to a folder where your Windows account can write data, then launch it again.', keywords: ['portable', 'profile', 'permission', 'writable', 'startup', 'database'] },
      { title: 'A terminal stopped responding', body: 'Check whether the remote command is still running and whether the connection is active. Ctrl+C sends the terminal interrupt key. If the session is disconnected, open a new one and review saved settings before retrying work.', keywords: ['frozen', 'stuck', 'interrupt', 'ctrl+c', 'disconnected', 'timeout'] }
    ]
  }
];

const KEYBOARD_SHORTCUTS: readonly KeyboardShortcut[] = [
  { keys: 'Ctrl+Shift+P', action: 'Open or close the command palette' },
  { keys: 'Ctrl+W / Ctrl+Shift+W', action: 'Start closing the active session tab' },
  { keys: 'Ctrl+Tab', action: 'Select the next open session tab' },
  { keys: 'Ctrl+Shift+Tab', action: 'Select the previous open session tab' },
  { keys: 'Ctrl+Alt+Shift, then assigned key', action: 'Open review for a macro with that saved shortcut; choose Run to start it' },
  { keys: 'Ctrl+V / Ctrl+Shift+V / Shift+Insert', action: 'Paste clipboard text into the focused terminal' },
  { keys: '← / →, Home / End (tab focused)', action: 'Select the previous or next tab, or the first or last tab' },
  { keys: '↑ / ↓, Home / End (tab menu focused)', action: 'Move through terminal tab actions' },
  { keys: 'Esc / Tab (terminal tab menu)', action: 'Close the menu and return focus to its tab' },
  { keys: '↑ / ↓, Enter, Esc, Tab (palette)', action: 'Move through, run, close, and move focus between palette controls' },
  { keys: 'Tab / Shift+Tab (dialog open)', action: 'Move through controls while focus stays inside the dialog' },
  { keys: 'Esc (SSH host prompt)', action: 'Reject the pending host key and stop the connection' },
  { keys: 'Tab / Shift+Tab / Esc (help open)', action: 'Move through help controls or close this guide' }
];

function matchesHelpText(text: string, filter: string): boolean {
  return text.toLocaleLowerCase().includes(filter.toLocaleLowerCase());
}

export function HelpDialog({ onClose }: { readonly onClose: () => void }) {
  const [filter, setFilter] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const normalizedFilter = filter.trim();
  const visibleSections = HELP_SECTIONS.map(section => ({
    ...section,
    topics: section.topics.filter(topic => matchesHelpText(
      `${topic.title} ${topic.body} ${topic.keywords.join(' ')}`, normalizedFilter
    ))
  })).filter(section => section.topics.length > 0);
  const visibleShortcuts = KEYBOARD_SHORTCUTS.filter(shortcut => matchesHelpText(
    `${shortcut.keys} ${shortcut.action} keyboard shortcut`, normalizedFilter
  ));
  const hasMatches = visibleSections.length > 0 || visibleShortcuts.length > 0;

  useEffect(() => { search.current?.focus(); }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(
      'input:not(:disabled), button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'
    )];
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const current = focusable.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && current <= 0) {
      event.preventDefault();
      focusable.at(-1)?.focus();
    } else if (!event.shiftKey && current === focusable.length - 1) {
      event.preventDefault();
      focusable[0]?.focus();
    }
  }

  return <div className="help-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-heading" onKeyDown={handleKeyDown}>
      <header className="help-header">
        <div>
          <h2 id="help-heading">Help &amp; keyboard shortcuts</h2>
          <p>Connection steps, terminal controls, and ways to recover from common problems.</p>
        </div>
        <button type="button" className="quiet-button" onClick={onClose}>Close</button>
      </header>
      <label className="visually-hidden" htmlFor="help-search">Search help</label>
      <input ref={search} id="help-search" className="help-search" name="help" type="search" autoComplete="off"
        placeholder="Search help…" value={filter} onChange={event => setFilter(event.target.value)} />
      <div className="help-content" role="region" aria-label="Help topics" tabIndex={0}>
        {!hasMatches && <p className="help-no-results" role="status">No help topics match “{filter}”. Try a connection type, action, or shortcut.</p>}
        {visibleSections.map(section => <section className="help-section" key={section.id} aria-labelledby={`help-section-${section.id}`}>
          <h3 id={`help-section-${section.id}`}>{section.title}</h3>
          <div className="help-topics">
            {section.topics.map(topic => <article className="help-topic" key={topic.title}>
              <h4>{topic.title}</h4>
              <p>{topic.body}</p>
            </article>)}
          </div>
        </section>)}
        {visibleShortcuts.length > 0 && <section className="help-section" aria-labelledby="help-shortcuts-heading">
          <h3 id="help-shortcuts-heading">Keyboard shortcuts</h3>
          <div className="help-shortcuts-table-wrap">
            <table className="help-shortcuts-table">
              <thead><tr><th scope="col">Keys</th><th scope="col">Action</th></tr></thead>
              <tbody>{visibleShortcuts.map(shortcut => <tr key={shortcut.keys}>
                <td><kbd>{shortcut.keys}</kbd></td><td>{shortcut.action}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </section>}
      </div>
      <footer className="help-footer"><span>Help searches stay on this device and are not sent to an online help service.</span></footer>
    </section>
  </div>;
}
