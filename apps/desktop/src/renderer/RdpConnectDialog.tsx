import { useRef, useState } from 'react';
import type { ReactElement, Ref } from 'react';
import { canonicalizeRdpEndpoint } from '../../../../packages/domain/src/rdp.ts';

export interface RdpConnectDialogProps {
  readonly dialogRef: Ref<HTMLElement>;
  readonly initialHost: string;
  readonly initialPort: number;
  readonly savedProfileName?: string;
  readonly onClose: () => void;
  readonly onLaunch: (host: string, port: number) => Promise<string | undefined>;
  readonly onSaveProfile: (name: string, host: string, port: number) => Promise<string | undefined>;
}

export function RdpConnectDialog({ dialogRef, initialHost, initialPort, savedProfileName, onClose, onLaunch, onSaveProfile }: RdpConnectDialogProps): ReactElement {
  const [host, setHost] = useState(initialHost);
  const [port, setPort] = useState(String(initialPort));
  const [name, setName] = useState(savedProfileName ?? initialHost);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const firstInput = useRef<HTMLInputElement>(null);
  const profileNameInput = useRef<HTMLInputElement>(null);

  function validatedEndpoint(): { readonly host: string; readonly port: number } | undefined {
    const parsedPort = Number(port);
    const endpoint = canonicalizeRdpEndpoint({ host, port: parsedPort });
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
    } catch { setError('Windows Remote Desktop could not be started. Check that the Windows viewer is available.'); }
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
    } catch { setError('The RDP profile could not be saved.'); }
    finally { setBusy(false); }
  }

  return <div className="ssh-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialogRef} className="ssh-connect-dialog rdp-connect-dialog" role="dialog" aria-modal="true"
      aria-labelledby="rdp-connect-heading" aria-describedby="rdp-connect-description rdp-external-warning" aria-busy={busy} data-testid="rdp-connect-dialog">
      <h2 id="rdp-connect-heading">Connect to an RDP desktop</h2>
      <p id="rdp-connect-description">Enter the remote host and port. The viewer opens outside MultiRemoteTerminal.</p>
      <div className="telnet-plaintext-warning" id="rdp-external-warning" role="note">
        <strong>External Windows Remote Desktop viewer.</strong> Windows handles authentication. MultiRemoteTerminal does not store RDP credentials or track whether the remote desktop connected.
      </div>
      <form onSubmit={event => { event.preventDefault(); void launch(); }}>
        <label htmlFor="rdp-host">Host name or IP address</label>
        <input ref={firstInput} id="rdp-host" name="host" type="text" autoComplete="off" spellCheck={false}
          placeholder="server.example.com…" disabled={busy} value={host} onChange={event => setHost(event.target.value)} />
        <label htmlFor="rdp-port">Port</label>
        <input id="rdp-port" name="port" type="number" inputMode="numeric" min="1" max="65535" step="1"
          disabled={busy} value={port} onChange={event => setPort(event.target.value)} />
        {!savedProfileName && <>
          <label htmlFor="rdp-profile-name">Saved profile name</label>
          <input ref={profileNameInput} id="rdp-profile-name" name="profileName" type="text" autoComplete="off" maxLength={256}
            disabled={busy} value={name} onChange={event => setName(event.target.value)} />
        </>}
        {error && <p className="dialog-error" role="alert">{error}</p>}
        <div className="ssh-connect-actions">
          <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
          {!savedProfileName && <button type="button" disabled={busy} onClick={() => void saveProfile()}>Save profile</button>}
          <button type="submit" className="ssh-primary" disabled={busy} data-mrt-rdp-launch-trigger data-testid="rdp-launch">
            {busy ? 'Starting viewer…' : 'Open Windows Remote Desktop'}
          </button>
        </div>
      </form>
    </section>
  </div>;
}
