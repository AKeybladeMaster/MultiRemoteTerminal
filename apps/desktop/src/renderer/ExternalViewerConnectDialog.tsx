import { useRef, useState } from 'react';
import type { ReactElement, Ref } from 'react';
import { canonicalizeRemoteEndpoint } from '../../../../packages/domain/src/remote-endpoint.ts';

export type ExternalViewerProtocol = 'rdp' | 'vnc';

export interface ExternalViewerConnectDialogProps {
  readonly protocol: ExternalViewerProtocol;
  readonly dialogRef: Ref<HTMLElement>;
  readonly initialHost: string;
  readonly initialPort: number;
  readonly savedProfileName?: string;
  readonly onClose: () => void;
  readonly onLaunch: (host: string, port: number) => Promise<string | undefined>;
  readonly onSaveProfile: (name: string, host: string, port: number) => Promise<string | undefined>;
}

export function ExternalViewerConnectDialog({ protocol, dialogRef, initialHost, initialPort, savedProfileName, onClose, onLaunch, onSaveProfile }: ExternalViewerConnectDialogProps): ReactElement {
  const [host, setHost] = useState(initialHost);
  const [port, setPort] = useState(String(initialPort));
  const [name, setName] = useState(savedProfileName ?? initialHost);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const firstInput = useRef<HTMLInputElement>(null);
  const profileNameInput = useRef<HTMLInputElement>(null);
  const idPrefix = protocol;
  const viewerName = protocol === 'rdp' ? 'Windows Remote Desktop' : 'TigerVNC';

  function validatedEndpoint(): { readonly host: string; readonly port: number } | undefined {
    const endpoint = canonicalizeRemoteEndpoint({ host, port: Number(port) });
    if (!endpoint) setError('Enter a valid DNS name or IP address and a port from 1 to 65535.');
    else setError(undefined);
    return endpoint;
  }

  async function launch(): Promise<void> {
    const endpoint = validatedEndpoint();
    if (!endpoint) { firstInput.current?.focus(); return; }
    setBusy(true);
    try {
      const failure = await onLaunch(endpoint.host, endpoint.port);
      if (failure) setError(failure);
      else onClose();
    } catch { setError(`${viewerName} could not be started. Check that the viewer is installed.`); }
    finally { setBusy(false); }
  }

  async function saveProfile(): Promise<void> {
    const endpoint = validatedEndpoint();
    if (!endpoint) { firstInput.current?.focus(); return; }
    const profileName = name.trim();
    if (!profileName || profileName.length > 256 || /[\u0000-\u001f\u007f]/.test(profileName)) {
      setError('Enter a profile name up to 256 characters.');
      profileNameInput.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const failure = await onSaveProfile(profileName, endpoint.host, endpoint.port);
      if (failure) setError(failure);
      else onClose();
    } catch { setError(`The ${protocol.toUpperCase()} profile could not be saved.`); }
    finally { setBusy(false); }
  }

  return <div className="ssh-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialogRef} className="ssh-connect-dialog rdp-connect-dialog" role="dialog" aria-modal="true"
      aria-labelledby={`${idPrefix}-connect-heading`} aria-describedby={`${idPrefix}-connect-description ${idPrefix}-external-warning`}
      aria-busy={busy} data-testid={`${idPrefix}-connect-dialog`}>
      <h2 id={`${idPrefix}-connect-heading`}>Connect to a {protocol.toUpperCase()} desktop</h2>
      <p id={`${idPrefix}-connect-description`}>Enter the remote host and port. The viewer opens outside MultiRemoteTerminal.</p>
      <div className="telnet-plaintext-warning" id={`${idPrefix}-external-warning`} role="note">
        {protocol === 'rdp'
          ? <><strong>External Windows Remote Desktop viewer.</strong> Windows handles authentication. MultiRemoteTerminal does not store RDP credentials or track whether the remote desktop connected.</>
          : <><strong>External TigerVNC viewer.</strong> TigerVNC handles authentication. Credentials are not saved in this app. VNC security and encryption depend on the server configuration; use a trusted server and suitable security settings.</>}
      </div>
      <form onSubmit={event => { event.preventDefault(); void launch(); }}>
        <label htmlFor={`${idPrefix}-host`}>Host name or IP address</label>
        <input ref={firstInput} id={`${idPrefix}-host`} name="host" type="text" autoComplete="off" spellCheck={false}
          placeholder="server.example.com…" disabled={busy} value={host} onChange={event => setHost(event.target.value)} />
        <label htmlFor={`${idPrefix}-port`}>Port</label>
        <input id={`${idPrefix}-port`} name="port" type="number" inputMode="numeric" min="1" max="65535" step="1"
          disabled={busy} value={port} onChange={event => setPort(event.target.value)} />
        {!savedProfileName && <>
          <label htmlFor={`${idPrefix}-profile-name`}>Saved profile name</label>
          <input ref={profileNameInput} id={`${idPrefix}-profile-name`} name="profileName" type="text" autoComplete="off" maxLength={256}
            disabled={busy} value={name} onChange={event => setName(event.target.value)} />
        </>}
        {error && <p className="dialog-error" role="alert">{error}</p>}
        <div className="ssh-connect-actions">
          <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
          {!savedProfileName && <button type="button" disabled={busy} onClick={() => void saveProfile()}>Save profile</button>}
          <button type="submit" className="ssh-primary" disabled={busy}
            data-mrt-rdp-launch-trigger={protocol === 'rdp' ? '' : undefined}
            data-mrt-vnc-launch-trigger={protocol === 'vnc' ? '' : undefined} data-testid={`${protocol}-launch`}>
            {busy ? 'Starting viewer…' : `Open ${viewerName}`}
          </button>
        </div>
      </form>
    </section>
  </div>;
}
