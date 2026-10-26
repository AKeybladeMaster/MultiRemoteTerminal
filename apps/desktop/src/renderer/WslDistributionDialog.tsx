import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import type { WslDistribution } from '../../../../packages/domain/src/wsl-distributions.ts';

export interface WslDistributionDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSelect: (distribution: string) => void;
}

type DiscoveryState = 'loading' | 'ready' | 'failed';

export function WslDistributionDialog({ open, onClose, onSelect }: WslDistributionDialogProps): ReactElement | null {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DiscoveryState>('loading');
  const [distributions, setDistributions] = useState<readonly WslDistribution[]>([]);
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState<string>();
  const dialog = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setState('loading');
    setDistributions([]);
    setSelected(undefined);
    setError(undefined);
    void window.multiRemoteTerminal.listWslDistributions().then(reply => {
      if (!current) return;
      if (!reply.ok) {
        setState('failed');
        setError('WSL could not return its installed distributions. Check WSL in Windows and retry.');
        return;
      }
      setDistributions(reply.result);
      setState('ready');
    }, () => {
      if (!current) return;
      setState('failed');
      setError('WSL could not return its installed distributions. Check WSL in Windows and retry.');
    });
    return () => {
      current = false;
      void window.multiRemoteTerminal.cancelWslDistributionDiscovery();
    };
  }, [attempt, open]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => dialog.current?.focus());
  }, [open]);

  if (!open) return null;

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []);
    const radioGroup = controls.filter((control): control is HTMLInputElement =>
      control instanceof HTMLInputElement && control.type === 'radio' && control.name === 'wsl-distribution');
    const radioControls = new Set<HTMLElement>(radioGroup);
    const radioEntry = radioGroup.find(input => input.checked) ?? radioGroup[0];
    const focusable = controls.filter(control => !radioControls.has(control));
    const radioPosition = controls.findIndex(control => radioControls.has(control));
    if (radioEntry && radioPosition >= 0) focusable.splice(radioPosition, 0, radioEntry);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (document.activeElement === dialog.current) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  function submit(): void {
    if (state === 'ready' && selected && distributions.some(distribution => distribution.name === selected)) onSelect(selected);
  }

  return <div className="ssh-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="ssh-connect-dialog wsl-distribution-dialog" role="dialog" aria-modal="true"
      aria-labelledby="wsl-distribution-heading" aria-describedby="wsl-distribution-description"
      aria-busy={state === 'loading'} tabIndex={-1} onKeyDown={handleKeyDown}>
      <h2 id="wsl-distribution-heading">Open a WSL terminal</h2>
      <p id="wsl-distribution-description">Choose the installed Linux distribution to open. The app will use this exact distribution.</p>
      {state === 'loading' && <p className="serial-port-status" role="status">Looking for installed WSL distributions…</p>}
      {error && <p className="dialog-error" role="alert">{error}</p>}
      {state === 'ready' && distributions.length === 0 && <p className="serial-port-status" role="status">
        No WSL distributions are installed. Install one in Windows, then refresh this list.
      </p>}
      {state === 'ready' && distributions.length > 0 && <fieldset className="wsl-distribution-fieldset">
        <legend>Installed distributions</legend>
        <ul className="wsl-distribution-list">
          {distributions.map(distribution => <li key={distribution.name}>
            <label className="wsl-distribution-choice">
              <input type="radio" name="wsl-distribution" value={distribution.name} checked={selected === distribution.name}
                onChange={() => setSelected(distribution.name)} />
              <span>{distribution.name}</span>
            </label>
          </li>)}
        </ul>
      </fieldset>}
      <div className="ssh-connect-actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" disabled={state === 'loading'} onClick={() => setAttempt(value => value + 1)}>Refresh</button>
        <button type="button" className="ssh-primary" disabled={state !== 'ready' || !selected} onClick={submit}>Open selected distribution</button>
      </div>
    </section>
  </div>;
}
