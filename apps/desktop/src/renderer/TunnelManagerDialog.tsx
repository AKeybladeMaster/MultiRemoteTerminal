import { useEffect, useState } from 'react';
import type { FormEvent, ReactElement, Ref } from 'react';
import type { SshTunnelSnapshot } from '../../../../packages/application/src/ssh-tunnels.ts';
import type { SavedSessionDefinition } from '../../../../packages/domain/src/session-definition.ts';
import type { SshTunnelDraft, SshTunnelMode, TunnelRunStatus } from '../../../../packages/domain/src/ssh-tunnel.ts';

export interface TunnelManagerDialogProps {
  readonly dialogRef: Ref<HTMLElement>;
  readonly profiles: readonly SavedSessionDefinition[];
  readonly tunnels: readonly SshTunnelSnapshot[];
  readonly loading: boolean;
  readonly busyId: string | undefined;
  readonly error: string | undefined;
  readonly onClose: () => void;
  readonly onSave: (draft: SshTunnelDraft) => Promise<string | undefined>;
  readonly onDelete: (id: string) => void;
  readonly onStart: (id: string) => void;
  readonly onStop: (id: string) => void;
}

function profileLabel(profile: SavedSessionDefinition): string {
  if (profile.kind === 'local') return profile.name;
  if (profile.kind === 'ssh' || profile.kind === 'sftp') return `${profile.name}  ·  ${profile.host}:${profile.port}  ·  ${profile.kind.toUpperCase()}`;
  return profile.name;
}

function statusLabel(status: TunnelRunStatus): string {
  if (status.state === 'active') return 'Active';
  if (status.state === 'starting') return 'Starting';
  if (status.state === 'stopping') return 'Stopping';
  if (status.state === 'failed') return `Stopped · ${status.errorCode}`;
  return 'Stopped';
}

function isRunning(status: TunnelRunStatus | undefined): boolean {
  return status?.state === 'active' || status?.state === 'starting' || status?.state === 'stopping';
}

export function TunnelManagerDialog({ dialogRef, profiles, tunnels, loading, busyId, error, onClose, onSave, onDelete, onStart, onStop }: TunnelManagerDialogProps): ReactElement {
  const eligibleProfiles = profiles.filter(profile => profile.kind === 'ssh' || profile.kind === 'sftp');
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<SshTunnelMode>('local');
  const [bindPort, setBindPort] = useState('0');
  const [targetHost, setTargetHost] = useState('');
  const [targetPort, setTargetPort] = useState('');
  const selected = tunnels.find(item => item.definition.id === selectedId);
  const [loadedSelectionId, setLoadedSelectionId] = useState<string>();
  const locked = isRunning(selected?.status);
  const busy = busyId !== undefined;

  useEffect(() => {
    if (!creating && !selectedId && tunnels.length > 0) setSelectedId(tunnels[0]?.definition.id);
  }, [creating, selectedId, tunnels]);

  useEffect(() => {
    if (!selected || loadedSelectionId === selected.definition.id) return;
    setLoadedSelectionId(selected.definition.id);
    setSessionId(selected.definition.sessionId);
    setName(selected.definition.name);
    setMode(selected.definition.mode);
    setBindPort(String(selected.definition.bindPort));
    setTargetHost(selected.definition.targetHost);
    setTargetPort(String(selected.definition.targetPort));
  }, [loadedSelectionId, selected]);

  useEffect(() => {
    if (!sessionId && eligibleProfiles.length > 0) setSessionId(eligibleProfiles[0]?.id ?? '');
  }, [eligibleProfiles, sessionId]);

  function startNew(): void {
    setCreating(true);
    setSelectedId(undefined);
    setLoadedSelectionId(undefined);
    setSessionId(eligibleProfiles[0]?.id ?? '');
    setName('');
    setMode('local');
    setBindPort('0');
    setTargetHost('');
    setTargetPort('');
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (locked || busy) return;
    const id = await onSave({ ...(selectedId ? { id: selectedId } : {}), sessionId, name, mode, bindHost: '127.0.0.1',
      bindPort: Number(bindPort), targetHost, targetPort: Number(targetPort) });
    if (id) { setCreating(false); setSelectedId(id); }
  }

  return <div className="ssh-backdrop tunnel-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="tunnel-manager" role="dialog" aria-modal="true" aria-labelledby="tunnel-manager-heading" aria-describedby="tunnel-manager-description"
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
        if (event.key !== 'Tab') return;
        const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)')];
        const current = focusable.indexOf(document.activeElement as HTMLElement);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && (current <= 0) && last) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (current === focusable.length - 1 || current < 0) && first) { event.preventDefault(); first.focus(); }
      }}>
      <header className="tunnel-manager-header">
        <div><p className="dialog-eyebrow">SSH ROUTING</p><h2 id="tunnel-manager-heading">Port forwarding</h2></div>
        <button className="tunnel-close" type="button" aria-label="Close port forwarding" onClick={onClose}>×</button>
      </header>
      <p className="tunnel-manager-description" id="tunnel-manager-description">
        Local forwards open a port on this computer and reach a service through SSH. Remote forwards request a port on the SSH server and send connections back here. Remote listeners stay bound to 127.0.0.1.
      </p>
      <div className="tunnel-manager-body">
        <section className="tunnel-list-column" aria-label="Saved tunnels">
          <div className="tunnel-list-header"><h3>Saved tunnels</h3><button type="button" className="tunnel-new" onClick={startNew}>+ New tunnel</button></div>
          {loading && <p className="tunnel-empty" role="status">Loading saved tunnels…</p>}
          {!loading && tunnels.length === 0 && <p className="tunnel-empty">Saved forwards will appear here.</p>}
          <ul className="tunnel-list">
            {tunnels.map(item => <li key={item.definition.id}>
              <button type="button" className={`tunnel-list-item ${selectedId === item.definition.id ? 'selected' : ''}`}
                aria-pressed={selectedId === item.definition.id} onClick={() => { setCreating(false); setSelectedId(item.definition.id); }}>
                <span className={`tunnel-state-dot ${item.status.state}`} aria-hidden="true" />
              <span className="tunnel-list-copy"><strong>{item.definition.name}</strong><small>{item.definition.mode === 'local' ? 'Local forward' : 'Remote forward'}</small><small>{item.definition.mode === 'local'
                ? `Local ${item.definition.bindHost}:${item.definition.bindPort || 'Auto'} → Remote ${item.definition.targetHost}:${item.definition.targetPort}`
                : `SSH server ${item.definition.bindHost}:${item.definition.bindPort || 'Auto'} → Local ${item.definition.targetHost}:${item.definition.targetPort}`}</small></span>
                <span className="tunnel-list-state">{statusLabel(item.status)}</span>
              </button>
            </li>)}
          </ul>
        </section>
        <section className="tunnel-editor-column" aria-label="Tunnel settings">
          <div className="tunnel-editor-heading"><span className="tunnel-editor-icon" aria-hidden="true">↗</span>
            <div><p className="dialog-eyebrow">{mode === 'local' ? 'LOCAL FORWARD' : 'REMOTE FORWARD'}</p><h3>{selected ? 'Forward settings' : `New ${mode} forward`}</h3></div></div>
          <form className="tunnel-form" onSubmit={event => { void submit(event); }}>
            <label htmlFor="tunnel-name">Tunnel name</label>
            <input id="tunnel-name" name="tunnelName" type="text" required maxLength={128} autoComplete="off" disabled={locked || busy}
              placeholder="Development database…" value={name} onChange={event => setName(event.target.value)} />

            <label htmlFor="tunnel-mode">Forward direction</label>
            <select id="tunnel-mode" name="forwardMode" required disabled={locked || busy} value={mode}
              onChange={event => setMode(event.target.value as SshTunnelMode)}>
              <option value="local">Local to remote service</option>
              <option value="remote">SSH server to local service</option>
            </select>

            <label htmlFor="tunnel-profile">SSH profile</label>
            <select id="tunnel-profile" name="sshProfileId" required disabled={locked || busy || eligibleProfiles.length === 0} value={sessionId}
              onChange={event => setSessionId(event.target.value)}>
              <option value="" disabled>Select a saved SSH or SFTP profile</option>
              {eligibleProfiles.map(profile => <option key={profile.id} value={profile.id}>{profileLabel(profile)}</option>)}
            </select>
            {eligibleProfiles.length === 0 && <p className="tunnel-hint">Save an SSH or SFTP profile first to create a forward.</p>}

            <div className="tunnel-endpoint-grid">
              <div><label htmlFor="tunnel-bind-port">{mode === 'local' ? 'Local port' : 'Remote port'}</label>
                <input id="tunnel-bind-port" name="bindPort" type="number" required min="0" max="65535" step="1" disabled={locked || busy}
                  value={bindPort} onChange={event => setBindPort(event.target.value)} />
              </div>
              <div className="tunnel-bind-host"><span className="tunnel-field-label">{mode === 'local' ? 'Local address' : 'SSH server address'}</span><code>127.0.0.1</code></div>
            </div>
            <p className="tunnel-hint">{mode === 'local' ? 'Use port 0 to let this computer choose an available port.' : 'Use port 0 to let the SSH server choose an available port. The listener is restricted to loopback.'}</p>

            <label htmlFor="tunnel-target-host">{mode === 'local' ? 'Remote destination host' : 'Local destination host'}</label>
            <input id="tunnel-target-host" name="targetHost" type="text" required maxLength={255} autoComplete="off" spellCheck={false} disabled={locked || busy}
              placeholder={mode === 'local' ? 'database.internal…' : '127.0.0.1'} value={targetHost} onChange={event => setTargetHost(event.target.value)} />
            <label htmlFor="tunnel-target-port">{mode === 'local' ? 'Remote destination port' : 'Local destination port'}</label>
            <input id="tunnel-target-port" name="targetPort" type="number" required min="1" max="65535" step="1" disabled={locked || busy}
              value={targetPort} onChange={event => setTargetPort(event.target.value)} />

            {selected && <div className={`tunnel-status-card ${selected.status.state}`} role="status" aria-live="polite">
              <span className={`tunnel-state-dot ${selected.status.state}`} aria-hidden="true" />
              <div><strong>{statusLabel(selected.status)}</strong><small>{selected.definition.mode === 'local' ? 'Local forward' : 'Remote forward'}</small>
                {selected.status.state === 'active' ? <code>{selected.definition.mode === 'local' ? 'Local' : 'SSH server'} {selected.status.bindHost}:{selected.status.bindPort} → {selected.definition.mode === 'local' ? 'Remote' : 'Local'} {selected.definition.targetHost}:{selected.definition.targetPort}</code>
                  : selected.status.state === 'failed' ? <small>The saved definition remains available to retry.</small>
                    : <small>Saved tunnels remain stopped until you start them.</small>}</div>
            </div>}
            {error && <p className="dialog-error" role="alert">{error}</p>}

            <div className="tunnel-actions">
              {selected && <button type="button" className="tunnel-delete" disabled={busy || locked} onClick={() => {
                if (window.confirm(`Delete the saved tunnel “${selected.definition.name}”?`)) onDelete(selected.definition.id);
              }}>Delete</button>}
              <span />
              {selected?.status.state === 'active' || selected?.status.state === 'starting'
                ? <button type="button" className="tunnel-stop" onClick={() => onStop(selected.definition.id)}>Stop tunnel</button>
                : <button type="button" className="tunnel-stop" disabled={!selected || selected.status.state === 'stopping' || busy}
                  onClick={() => selected && onStart(selected.definition.id)}>Start tunnel</button>}
              <button type="submit" className="ssh-primary" disabled={locked || busy || eligibleProfiles.length === 0}>{busy ? 'Working…' : 'Save tunnel'}</button>
            </div>
          </form>
        </section>
      </div>
    </section>
  </div>;
}
