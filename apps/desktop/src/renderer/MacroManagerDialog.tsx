import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactElement, Ref } from 'react';
import { MAX_MACRO_STEPS, normalizeMacroDraft } from '../../../../packages/domain/src/macro.ts';
import type { MacroDefinition, MacroDraft, MacroStep } from '../../../../packages/domain/src/macro.ts';

export interface MacroManagerDialogProps {
  readonly dialogRef: Ref<HTMLElement>;
  readonly macros: readonly MacroDefinition[];
  readonly loading: boolean;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly recordingTargets: readonly { readonly sessionId: string; readonly title: string }[];
  readonly recordingActive: boolean;
  readonly onClose: () => void;
  readonly onSave: (id: string | undefined, draft: MacroDraft) => Promise<string | undefined>;
  readonly onDelete: (id: string) => Promise<boolean>;
  readonly onStartRecording: (name: string, sessionId: string) => boolean;
}

type MacroStepKind = MacroStep['kind'];

function newStep(kind: MacroStepKind): MacroStep {
  if (kind === 'send') return { kind, text: '' };
  if (kind === 'waitForText') return { kind, text: '', timeoutMs: 10_000 };
  if (kind === 'delay') return { kind, durationMs: 1_000 };
  return { kind, message: '' };
}

function stepSummary(step: MacroStep): string {
  if (step.kind === 'send') return step.text || 'Enter a command';
  if (step.kind === 'waitForText') return step.text || 'Enter text to wait for';
  if (step.kind === 'delay') return `Wait ${step.durationMs} ms`;
  return step.message || 'Enter a confirmation prompt';
}

function updateStep(steps: readonly MacroStep[], index: number, next: MacroStep): MacroStep[] {
  return steps.map((step, current) => current === index ? next : step);
}

export function MacroManagerDialog({ dialogRef, macros, loading, busy, error, recordingTargets, recordingActive, onClose, onSave, onDelete, onStartRecording }: MacroManagerDialogProps): ReactElement {
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<readonly MacroStep[]>([]);
  const [stepToAdd, setStepToAdd] = useState<MacroStepKind>('send');
  const [deleteConfirmation, setDeleteConfirmation] = useState(false);
  const [recordingName, setRecordingName] = useState('');
  const [recordingTargetId, setRecordingTargetId] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);
  const selected = macros.find(macro => macro.id === selectedId);

  useEffect(() => {
    if (!creating) return;
    const focusFrame = requestAnimationFrame(() => nameInput.current?.focus());
    return () => cancelAnimationFrame(focusFrame);
  }, [creating]);

  useEffect(() => {
    if (!creating && selectedId && !macros.some(macro => macro.id === selectedId)) setSelectedId(undefined);
  }, [creating, macros, selectedId]);

  useEffect(() => {
    if (creating || !selected) return;
    setName(selected.name);
    setDescription(selected.description ?? '');
    setSteps(selected.steps);
    setDeleteConfirmation(false);
  }, [creating, selected]);

  function startNew(): void {
    setCreating(true);
    setSelectedId(undefined);
    setName('');
    setDescription('');
    setSteps([]);
    setDeleteConfirmation(false);
  }

  function selectMacro(id: string): void {
    setCreating(false);
    setSelectedId(id);
    setDeleteConfirmation(false);
  }

  function changeStepKind(index: number, kind: MacroStepKind): void {
    setSteps(current => updateStep(current, index, newStep(kind)));
  }

  function moveStep(index: number, direction: -1 | 1): void {
    setSteps(current => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const reordered = [...current];
      [reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!];
      return reordered;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !canSave) return;
    const draft = normalizeMacroDraft({ name, ...(description.trim() ? { description } : {}), steps });
    if (!draft) return;
    const id = await onSave(creating ? undefined : selectedId, draft);
    if (id) {
      setCreating(false);
      setSelectedId(id);
      setDeleteConfirmation(false);
    }
  }

  function submitRecording(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const targetId = recordingTargetId || recordingTargets[0]?.sessionId;
    if (busy || recordingActive || !targetId || !normalizeMacroDraft({ name: recordingName, steps: [] })) return;
    if (onStartRecording(recordingName, targetId)) setRecordingName('');
  }

  async function confirmDelete(): Promise<void> {
    if (!selected || busy) return;
    if (await onDelete(selected.id)) {
      setSelectedId(undefined);
      setDeleteConfirmation(false);
    }
  }

  const draft = normalizeMacroDraft({ name, ...(description.trim() ? { description } : {}), steps });
  const canSave = draft !== undefined && (creating || selected !== undefined);
  const canEdit = creating || selected !== undefined;

  return <div className="ssh-backdrop tunnel-backdrop macro-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialogRef} className="tunnel-manager macro-manager" role="dialog" aria-modal="true" aria-labelledby="macro-manager-heading" aria-describedby="macro-manager-description macro-storage-warning"
      onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); } }}>
      <header className="tunnel-manager-header">
        <div><p className="dialog-eyebrow">Reusable terminal actions</p><h2 id="macro-manager-heading">Macros</h2></div>
        <button className="tunnel-close" type="button" aria-label="Close macro manager" onClick={onClose} disabled={busy}>×</button>
      </header>
      <p id="macro-manager-description" className="tunnel-manager-description">Create typed steps or record complete input lines from one running terminal.</p>
      <p id="macro-storage-warning" className="macro-storage-warning"><strong>Keep secrets out of macro fields.</strong> Names, descriptions and step text are stored in the local database. Do not include passwords, tokens or private key content.</p>
      <div className="tunnel-manager-body macro-manager-body">
        <section className="tunnel-list-column" aria-labelledby="macro-list-heading">
          <div className="tunnel-list-header"><h3 id="macro-list-heading">Saved macros</h3><button className="tunnel-new" type="button" onClick={startNew} disabled={busy}>New macro</button></div>
          <form className="macro-record-setup" onSubmit={submitRecording}>
            <label htmlFor="macro-recording-name">New recording name</label>
            <input id="macro-recording-name" value={recordingName} maxLength={256} onChange={event => setRecordingName(event.target.value)} disabled={busy || recordingActive} required autoComplete="off" />
            <label htmlFor="macro-recording-target">Running terminal</label>
            <select id="macro-recording-target" value={recordingTargetId || recordingTargets[0]?.sessionId || ''} onChange={event => setRecordingTargetId(event.target.value)} disabled={busy || recordingTargets.length === 0 || recordingActive}>
              {recordingTargets.length === 0 ? <option value="">No running terminals</option> : recordingTargets.map(target => <option key={target.sessionId} value={target.sessionId}>{target.title}</option>)}
            </select>
            <button type="submit" disabled={busy || recordingActive || recordingTargets.length === 0 || !normalizeMacroDraft({ name: recordingName, steps: [] })}>Start recording</button>
            {recordingTargets.length === 0 && <small>Open a local, SSH or Telnet terminal first.</small>}
          </form>
          {loading ? <p className="tunnel-empty" role="status">Loading saved macros…</p> : macros.length === 0
            ? <p className="tunnel-empty">No macros saved yet. Create one to define its steps.</p>
            : <ul className="tunnel-list" aria-label="Saved macros">
              {macros.map(macro => <li key={macro.id}>
                <button className={`tunnel-list-item macro-list-item${macro.id === selectedId && !creating ? ' selected' : ''}`} type="button"
                  aria-current={macro.id === selectedId && !creating ? 'true' : undefined} onClick={() => selectMacro(macro.id)} disabled={busy}>
                  <span className="macro-list-mark" aria-hidden="true">≋</span>
                  <span className="tunnel-list-copy"><strong>{macro.name}</strong><small>{macro.steps.length} {macro.steps.length === 1 ? 'step' : 'steps'}{macro.description ? ` · ${macro.description}` : ''}</small></span>
                </button>
              </li>)}
            </ul>}
        </section>
        <section className="tunnel-editor-column macro-editor-column" aria-label={creating ? 'New macro' : selected ? `Edit ${selected.name}` : 'Macro details'}>
          {canEdit ? <>
            <div className="tunnel-editor-heading"><span className="tunnel-editor-icon" aria-hidden="true">≋</span><div><p className="dialog-eyebrow">{creating ? 'New definition' : 'Macro definition'}</p><h3>{creating ? 'Define a macro' : 'Edit macro'}</h3></div></div>
            <form className="tunnel-form macro-form" onSubmit={event => { void submit(event); }}>
              <label htmlFor="macro-name">Name</label>
              <input ref={nameInput} id="macro-name" value={name} maxLength={256} onChange={event => setName(event.target.value)} disabled={busy} required autoComplete="off" />
              <label htmlFor="macro-description">Description <span>(optional)</span></label>
              <input id="macro-description" value={description} maxLength={1024} onChange={event => setDescription(event.target.value)} disabled={busy} autoComplete="off" />
              <div className="macro-steps-heading"><div><span className="tunnel-field-label">Ordered steps</span><small>{steps.length} / {MAX_MACRO_STEPS}</small></div>
                <div className="macro-add-step"><label className="visually-hidden" htmlFor="macro-step-kind">Step type to add</label>
                  <select id="macro-step-kind" value={stepToAdd} disabled={busy || steps.length >= MAX_MACRO_STEPS} onChange={event => setStepToAdd(event.target.value as MacroStepKind)}>
                    <option value="send">Add send command</option><option value="waitForText">Add wait for text</option><option value="delay">Add delay</option><option value="confirm">Add confirmation</option>
                  </select>
                  <button type="button" onClick={() => setSteps(current => current.length >= MAX_MACRO_STEPS ? current : [...current, newStep(stepToAdd)])} disabled={busy || steps.length >= MAX_MACRO_STEPS}>Add step</button>
                </div>
              </div>
              {steps.length === 0 ? <p className="macro-no-steps">No steps yet. Choose a step type to add one.</p> : <ol className="macro-steps">
                {steps.map((step, index) => <li className="macro-step" key={index}>
                  <div className="macro-step-heading"><span className="macro-step-number">{index + 1}</span>
                    <select aria-label={`Step ${index + 1} type`} value={step.kind} disabled={busy} onChange={event => changeStepKind(index, event.target.value as MacroStepKind)}>
                      <option value="send">Send command</option><option value="waitForText">Wait for text</option><option value="delay">Delay</option><option value="confirm">Confirmation</option>
                    </select>
                    <button type="button" aria-label={`Move step ${index + 1} up`} onClick={() => moveStep(index, -1)} disabled={busy || index === 0}>↑</button>
                    <button type="button" aria-label={`Move step ${index + 1} down`} onClick={() => moveStep(index, 1)} disabled={busy || index === steps.length - 1}>↓</button>
                    <button type="button" className="macro-remove-step" aria-label={`Remove step ${index + 1}`} onClick={() => setSteps(current => current.filter((_, currentIndex) => currentIndex !== index))} disabled={busy}>Remove</button>
                  </div>
                  {step.kind === 'send' && <><label htmlFor={`macro-step-${index}-text`}>Command</label><input id={`macro-step-${index}-text`} value={step.text} maxLength={4096} placeholder="One command line" onChange={event => setSteps(current => updateStep(current, index, { ...step, text: event.target.value }))} disabled={busy} autoComplete="off" /></>}
                  {step.kind === 'waitForText' && <><label htmlFor={`macro-step-${index}-text`}>Text to wait for</label><input id={`macro-step-${index}-text`} value={step.text} maxLength={512} onChange={event => setSteps(current => updateStep(current, index, { ...step, text: event.target.value }))} disabled={busy} />
                    <label htmlFor={`macro-step-${index}-timeout`}>Timeout (milliseconds)</label><input id={`macro-step-${index}-timeout`} type="number" min={1000} max={120000} step={1000} value={step.timeoutMs} onChange={event => setSteps(current => updateStep(current, index, { ...step, timeoutMs: Number(event.target.value) }))} disabled={busy} /></>}
                  {step.kind === 'delay' && <><label htmlFor={`macro-step-${index}-duration`}>Delay (milliseconds)</label><input id={`macro-step-${index}-duration`} type="number" min={0} max={120000} step={100} value={step.durationMs} onChange={event => setSteps(current => updateStep(current, index, { ...step, durationMs: Number(event.target.value) }))} disabled={busy} /></>}
                  {step.kind === 'confirm' && <><label htmlFor={`macro-step-${index}-message`}>Confirmation message</label><input id={`macro-step-${index}-message`} value={step.message} maxLength={256} onChange={event => setSteps(current => updateStep(current, index, { ...step, message: event.target.value }))} disabled={busy} /></>}
                  <p className="macro-step-summary">{stepSummary(step)}</p>
                </li>)}
              </ol>}
              {error && <p className="dialog-error" role="alert">{error}</p>}
              {deleteConfirmation && selected && <div className="macro-delete-confirm" role="group" aria-label="Confirm macro deletion">
                <p>Delete <strong>{selected.name}</strong>? This cannot be undone.</p>
                <button type="button" className="macro-delete-confirm-button" onClick={() => { void confirmDelete(); }} disabled={busy}>Delete macro</button>
                <button type="button" onClick={() => setDeleteConfirmation(false)} disabled={busy}>Keep macro</button>
              </div>}
              <div className="tunnel-actions macro-actions"><span>{busy ? 'Saving…' : 'Saved on this device'}</span>
                {!creating && selected && <button type="button" className="tunnel-delete" onClick={() => setDeleteConfirmation(true)} disabled={busy}>Delete</button>}
                <button type="button" onClick={onClose} disabled={busy}>Close</button>
                <button type="submit" className="ssh-primary" disabled={busy || !canSave}>{creating ? 'Create macro' : 'Save changes'}</button>
              </div>
            </form>
          </> : <div className="macro-empty-editor">
            <span className="tunnel-editor-icon" aria-hidden="true">≋</span><h3>Select a macro</h3><p>Choose a saved definition or create a new one. A macro stores only its name, description, and ordered steps.</p>
          </div>}
          {!canEdit && error && <p className="dialog-error" role="alert">{error}</p>}
        </section>
      </div>
    </section>
  </div>;
}
