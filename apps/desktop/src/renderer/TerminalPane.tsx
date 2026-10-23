import { useLayoutEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import type { ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

export type TerminalTheme = 'dark' | 'light';

export interface TerminalUiHandle {
  readonly write: (data: string, onParsed: () => void) => void;
  readonly focus: () => void;
}

interface Props {
  readonly sessionId: string;
  readonly title: string;
  readonly active: boolean;
  readonly canWrite: boolean;
  readonly theme: TerminalTheme;
  readonly fontSize: number;
  readonly onReady: (sessionId: string, handle: TerminalUiHandle | undefined) => void;
  readonly onError: (message: string) => void;
}

const terminalThemes: Record<TerminalTheme, ITheme> = {
  dark: {
    background: '#101c28', foreground: '#e7edf4', cursor: '#f5ce85', cursorAccent: '#142231',
    selectionBackground: '#38546f', black: '#142231', red: '#e98d8d', green: '#9bd0a8', yellow: '#f5ce85',
    blue: '#a5c9f4', magenta: '#d3afe8', cyan: '#8ccfd2', white: '#e7edf4',
    brightBlack: '#74879a', brightRed: '#f19e9e', brightGreen: '#afe1bb', brightYellow: '#ffdfa0',
    brightBlue: '#c0dafa', brightMagenta: '#e3c3f4', brightCyan: '#a8e0e1', brightWhite: '#ffffff'
  },
  light: {
    background: '#fbfcfe', foreground: '#182a3d', cursor: '#825600', cursorAccent: '#ffffff',
    selectionBackground: '#c3d8ee', black: '#182a3d', red: '#a53232', green: '#327145', yellow: '#825600',
    blue: '#275b96', magenta: '#6d4388', cyan: '#216c70', white: '#f3f6fa',
    brightBlack: '#52687e', brightRed: '#bd4747', brightGreen: '#428a5b', brightYellow: '#956600',
    brightBlue: '#3973b5', brightMagenta: '#8757a6', brightCyan: '#36878b', brightWhite: '#ffffff'
  }
};

export function TerminalPane({ sessionId, title, active, canWrite, theme, fontSize, onReady, onError }: Props) {
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
      void window.multiRemoteTerminal.writeTerminal(sessionId, data).then(reply => {
        if (!reply.ok) onError(`Terminal input could not be sent (${reply.error.code}).`);
      });
    });
    instance.onResize(({ cols, rows }) => {
      if (!canWriteRef.current) return;
      void window.multiRemoteTerminal.resizeTerminal(sessionId, cols, rows).then(reply => {
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
      focus: () => instance.focus()
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
  }, [sessionId, title, onReady, onError]);

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
