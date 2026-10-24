import { useLayoutEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { terminalThemes } from './terminal-theme.ts';
import type { TerminalTheme } from './terminal-theme.ts';

export type { TerminalTheme } from './terminal-theme.ts';

export interface TerminalUiHandle {
  readonly write: (data: string, onParsed: () => void) => void;
  readonly focus: () => void;
  readonly clear: () => void;
  readonly copySelection: () => Promise<boolean>;
  readonly acknowledgeOutput: (sequence: number) => Promise<void>;
}

interface Props {
  readonly sessionId: string;
  readonly title: string;
  readonly transport: 'local' | 'ssh';
  readonly active: boolean;
  readonly canWrite: boolean;
  readonly theme: TerminalTheme;
  readonly fontSize: number;
  readonly onReady: (sessionId: string, handle: TerminalUiHandle | undefined) => void;
  readonly onError: (message: string) => void;
}

export function TerminalPane({ sessionId, title, transport, active, canWrite, theme, fontSize, onReady, onError }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | undefined>(undefined);
  const fit = useRef<FitAddon | undefined>(undefined);
  const activeRef = useRef(active);
  const canWriteRef = useRef(canWrite);
  activeRef.current = active;
  canWriteRef.current = canWrite;

  useLayoutEffect(() => {
    if (!host.current) return;
    const instance = new Terminal({
      allowProposedApi: false, convertEol: false, cursorBlink: true, cursorStyle: 'block',
      fontFamily: '"Cascadia Mono", Consolas, monospace', fontSize, lineHeight: 1.35,
      scrollback: 3_000, screenReaderMode: true, theme: terminalThemes[theme]
    });
    const fitAddon = new FitAddon();
    instance.loadAddon(fitAddon);
    instance.onData(data => {
      if (!canWriteRef.current) return;
      const sent = transport === 'ssh'
        ? window.multiRemoteTerminal.writeSshTerminal(sessionId, data)
        : window.multiRemoteTerminal.writeTerminal(sessionId, data);
      void sent.then(reply => {
        if (!reply.ok) onError(`Terminal input could not be sent (${reply.error.code}).`);
      });
    });
    instance.onResize(({ cols, rows }) => {
      if (!canWriteRef.current) return;
      const resized = transport === 'ssh'
        ? window.multiRemoteTerminal.resizeSshTerminal(sessionId, cols, rows)
        : window.multiRemoteTerminal.resizeTerminal(sessionId, cols, rows);
      void resized.then(reply => {
        if (!reply.ok) onError(`Terminal size could not be updated (${reply.error.code}).`);
      });
    });
    instance.open(host.current);
    terminal.current = instance;
    fit.current = fitAddon;
    const observer = new ResizeObserver(() => { if (activeRef.current) fitAddon.fit(); });
    observer.observe(host.current);
    const handle: TerminalUiHandle = Object.freeze({
      write: (data: string, onParsed: () => void) => instance.write(data, onParsed),
      focus: () => instance.focus(),
      clear: () => instance.clear(),
      copySelection: async () => {
        const selection = instance.getSelection();
        if (!selection) return false;
        await navigator.clipboard.writeText(selection);
        return true;
      },
      acknowledgeOutput: async (sequence: number) => {
        const reply = transport === 'ssh'
          ? await window.multiRemoteTerminal.acknowledgeSshTerminalOutput(sessionId, sequence)
          : await window.multiRemoteTerminal.acknowledgeTerminalOutput(sessionId, sequence);
        if (!reply.ok) onError(`Terminal output could not be acknowledged (${reply.error.code}).`);
      }
    });
    onReady(sessionId, handle);
    requestAnimationFrame(() => { if (activeRef.current) fitAddon.fit(); });
    return () => {
      observer.disconnect();
      onReady(sessionId, undefined);
      instance.dispose();
      terminal.current = undefined;
      fit.current = undefined;
    };
  }, [sessionId, title, transport, onReady, onError]);

  useLayoutEffect(() => {
    const instance = terminal.current;
    const fitAddon = fit.current;
    if (!instance || !fitAddon) return;
    instance.options.theme = terminalThemes[theme];
    instance.options.fontSize = fontSize;
    if (active) requestAnimationFrame(() => fitAddon.fit());
  }, [active, fontSize, theme]);

  return <div className="terminal-host" ref={host} aria-label={`${title} terminal output`} />;
}
