import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { WorkbenchSnapshot } from '../../../../packages/application/src/workbench.ts';
import type { AppError } from '../../../../packages/domain/src/errors.ts';
import './tokens.css';

function Foundation() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<AppError>();

  async function refresh() {
    setState('loading');
    const reply = await window.multiRemoteTerminal.describe();
    if (reply.ok) { setSnapshot(reply.result); setState('ready'); }
    else { setError(reply.error); setState('error'); }
  }

  useEffect(() => { void refresh(); }, []);

  return <div className="workbench" data-theme={theme}>
    <a className="skip" href="#preview">Skip to preview</a>
    <header><span className="wordmark">MultiRemoteTerminal</span><span className="build-label">Foundation preview</span></header>
    <div className="workspace">
      <aside aria-label="Workspace overview"><h2>Workspace</h2><p>No connections yet.</p><p>Local terminals are the next development slice.</p></aside>
      <main id="preview" tabIndex={-1}>
        <h1>A workspace for your terminals.</h1>
        <p>This development build checks the desktop shell and its security controls. Terminal connections are not available yet.</p>
        <section aria-labelledby="appearance"><h2 id="appearance">Appearance preview</h2>
          <div className="toolbar"><button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>Switch to {theme === 'dark' ? 'light' : 'dark'} theme</button>
            <button type="button" onClick={() => void refresh()} disabled={state === 'loading'}>Refresh app status</button></div>
          <div className="terminal-sample" aria-label="Terminal typography sample"><code>PowerShell / cmd<br />Unicode preview: café · 東京 · λ<br /><span className="muted">This is sample text. No shell is running.</span></code></div>
          <div className="swatches" aria-label="Color tokens"><span className="swatch surface">Surface</span><span className="swatch accent">Accent</span><span className="swatch focus">Focus</span></div>
        </section>
        <section aria-labelledby="app-status"><h2 id="app-status">App status</h2>
          <p role="status">{state === 'loading' ? 'Checking app status…' : state === 'error' ?
            `App status unavailable (${error?.code}, ${error?.target}). ${error?.retryable ? 'Try refreshing.' : 'Restart the app to try again.'}` :
            `Ready · ${snapshot?.platform} · version ${snapshot?.version}`}</p>
        </section>
      </main>
    </div>
    <footer><span>Development build</span><span>No active connections</span></footer>
  </div>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(<Foundation />);
