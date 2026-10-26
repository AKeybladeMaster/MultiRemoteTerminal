import { useLayoutEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { terminalThemes } from './terminal-theme.ts';
import type { TerminalTheme } from './terminal-theme.ts';
import { attachTerminalHighlights, clearTerminalShellInputAnchor, isShellPromptAtCursor } from './terminal-highlighting.ts';
import type { TerminalShellInputAnchor } from './terminal-highlighting.ts';
import type { TerminalHighlightRule } from '../../../../packages/domain/src/terminal-highlights.ts';
import type { DesktopBridge, TerminalActionReply } from '../../../../packages/contracts/src/commands.ts';

export type { TerminalTheme } from './terminal-theme.ts';

export interface TerminalUiHandle {
  readonly write: (data: string, onParsed: () => void) => void;
  readonly focus: () => void;
  readonly currentLineText: () => string;
  readonly clear: () => void;
  readonly copySelection: () => Promise<boolean>;
  readonly acknowledgeOutput: (sequence: number) => Promise<void>;
}

interface Props {
  readonly sessionId: string;
  readonly title: string;
  readonly transport: 'local' | 'ssh' | 'telnet' | 'serial';
  readonly active: boolean;
  readonly canWrite: boolean;
  readonly theme: TerminalTheme;
  readonly fontSize: number;
  readonly terminalHighlightEnabled: boolean;
  readonly terminalHighlightRules: readonly TerminalHighlightRule[];
  readonly terminalShellSyntaxEnabled: boolean;
  readonly onInput: (sessionId: string, data: string) => void;
  readonly onOutput: (sessionId: string, data: string) => void;
  readonly onReady: (sessionId: string, handle: TerminalUiHandle | undefined) => void;
  readonly onError: (message: string) => void;
}

interface TerminalTransportCommands {
  readonly write: (sessionId: string, data: string) => Promise<TerminalActionReply>;
  readonly paste: (sessionId: string) => Promise<TerminalActionReply>;
  readonly resize: (sessionId: string, columns: number, rows: number) => Promise<TerminalActionReply>;
  readonly acknowledge: (sessionId: string, sequence: number) => Promise<TerminalActionReply>;
}

function createTransportCommands(bridge: DesktopBridge, transport: Props['transport']): TerminalTransportCommands {
  const commands: Record<Props['transport'], TerminalTransportCommands> = {
    local: {
      write: (sessionId, data) => bridge.writeTerminal(sessionId, data),
      paste: sessionId => bridge.pasteTerminal(sessionId),
      resize: (sessionId, columns, rows) => bridge.resizeTerminal(sessionId, columns, rows),
      acknowledge: (sessionId, sequence) => bridge.acknowledgeTerminalOutput(sessionId, sequence)
    },
    ssh: {
      write: (sessionId, data) => bridge.writeSshTerminal(sessionId, data),
      paste: sessionId => bridge.pasteSshTerminal(sessionId),
      resize: (sessionId, columns, rows) => bridge.resizeSshTerminal(sessionId, columns, rows),
      acknowledge: (sessionId, sequence) => bridge.acknowledgeSshTerminalOutput(sessionId, sequence)
    },
    telnet: {
      write: (sessionId, data) => bridge.writeTelnetTerminal(sessionId, data),
      paste: sessionId => bridge.pasteTelnetTerminal(sessionId),
      resize: (sessionId, columns, rows) => bridge.resizeTelnetTerminal(sessionId, columns, rows),
      acknowledge: (sessionId, sequence) => bridge.acknowledgeTelnetTerminalOutput(sessionId, sequence)
    },
    serial: {
      write: (sessionId, data) => bridge.writeSerialTerminal(sessionId, data),
      paste: sessionId => bridge.pasteSerialTerminal(sessionId),
      resize: (sessionId, columns, rows) => bridge.resizeSerialTerminal(sessionId, columns, rows),
      acknowledge: (sessionId, sequence) => bridge.acknowledgeSerialTerminalOutput(sessionId, sequence)
    }
  };
  return commands[transport];
}

export function TerminalPane({ sessionId, title, transport, active, canWrite, theme, fontSize,
  terminalHighlightEnabled, terminalHighlightRules, terminalShellSyntaxEnabled, onInput, onOutput, onReady, onError }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | undefined>(undefined);
  const fit = useRef<FitAddon | undefined>(undefined);
  const activeRef = useRef(active);
  const canWriteRef = useRef(canWrite);
  const shellSyntaxEnabledRef = useRef(terminalShellSyntaxEnabled);
  const shellInputAnchor = useRef<TerminalShellInputAnchor | undefined>(undefined);
  activeRef.current = active;
  canWriteRef.current = canWrite;
  shellSyntaxEnabledRef.current = terminalShellSyntaxEnabled;

  function beginShellInputAnchor(instance: Terminal): void {
    if (!shellSyntaxEnabledRef.current || transport === 'serial') return;
    const buffer = instance.buffer.active;
    if (buffer.type !== 'normal') return;
    const cursorLine = buffer.baseY + buffer.cursorY;
    const existing = shellInputAnchor.current;
    if (existing && !existing.marker.isDisposed && existing.marker.line === cursorLine) return;
    clearTerminalShellInputAnchor(shellInputAnchor);
    const line = buffer.getLine(cursorLine);
    const promptText = line?.translateToString(true, 0, buffer.cursorX) ?? '';
    if (!isShellPromptAtCursor(promptText)) return;
    const marker = instance.registerMarker(0);
    if (!marker.isDisposed) shellInputAnchor.current = { marker, startColumn: buffer.cursorX };
  }

  useLayoutEffect(() => {
    if (!host.current) return;
    const commands = createTransportCommands(window.multiRemoteTerminal, transport);
    const instance = new Terminal({
      allowProposedApi: true, convertEol: false, cursorBlink: true, cursorStyle: 'block',
      fontFamily: '"Cascadia Mono", Consolas, monospace', fontSize, lineHeight: 1.35,
      scrollback: 3_000, screenReaderMode: true, theme: terminalThemes[theme]
    });
    const fitAddon = new FitAddon();
    instance.loadAddon(fitAddon);
    instance.onData(data => {
      if (!canWriteRef.current) return;
      if (/[\r\n\x03\x04\x0c]/u.test(data)) clearTerminalShellInputAnchor(shellInputAnchor);
      else beginShellInputAnchor(instance);
      onInput(sessionId, data);
      const sent = commands.write(sessionId, data);
      void sent.then(reply => {
        if (!reply.ok) onError(`Terminal input could not be sent (${reply.error.code}).`);
      });
    });
    const pasteFromClipboard = () => {
      if (!canWriteRef.current) return;
      beginShellInputAnchor(instance);
      const pasted = commands.paste(sessionId);
      void pasted.then(reply => {
        if (!reply.ok) clearTerminalShellInputAnchor(shellInputAnchor);
        if (!reply.ok) onError(`Clipboard text could not be pasted (${reply.error.code}).`);
      });
    };
    instance.attachCustomKeyEventHandler(event => {
      if (event.type !== 'keydown') return true;
      const pasteShortcut = (event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'v') || (event.shiftKey && event.key === 'Insert');
      if (!pasteShortcut) return true;
      event.preventDefault();
      pasteFromClipboard();
      return false;
    });
    const onPaste = (event: ClipboardEvent) => { event.preventDefault(); pasteFromClipboard(); };
    host.current.addEventListener('paste', onPaste);
    instance.onResize(({ cols, rows }) => {
      if (!canWriteRef.current) return;
      const resized = commands.resize(sessionId, cols, rows);
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
      write: (data: string, onParsed: () => void) => {
        onOutput(sessionId, data);
        instance.write(data, onParsed);
      },
      focus: () => instance.focus(),
      currentLineText: () => {
        const buffer = instance.buffer.active;
        return buffer.getLine(buffer.baseY + buffer.cursorY)?.translateToString(true, 0, buffer.cursorX) ?? '';
      },
      clear: () => instance.clear(),
      copySelection: async () => {
        const selection = instance.getSelection();
        if (!selection) return false;
        await navigator.clipboard.writeText(selection);
        return true;
      },
      acknowledgeOutput: async (sequence: number) => {
        const reply = await commands.acknowledge(sessionId, sequence);
        if (!reply.ok) onError(`Terminal output could not be acknowledged (${reply.error.code}).`);
      }
    });
    onReady(sessionId, handle);
    requestAnimationFrame(() => { if (activeRef.current) fitAddon.fit(); });
    return () => {
      observer.disconnect();
      host.current?.removeEventListener('paste', onPaste);
      clearTerminalShellInputAnchor(shellInputAnchor);
      onReady(sessionId, undefined);
      instance.dispose();
      terminal.current = undefined;
      fit.current = undefined;
    };
  }, [sessionId, title, transport, onInput, onOutput, onReady, onError]);

  useLayoutEffect(() => {
    const instance = terminal.current;
    if (!instance) return;
    if (!terminalShellSyntaxEnabled) clearTerminalShellInputAnchor(shellInputAnchor);
    const highlights = attachTerminalHighlights(instance, {
      keywordHighlightingEnabled: terminalHighlightEnabled, keywordRules: terminalHighlightRules,
      shellSyntaxEnabled: terminalShellSyntaxEnabled && transport !== 'serial',
      getShellInputAnchor: () => shellInputAnchor.current, theme
    });
    return () => highlights.dispose();
  }, [terminalHighlightEnabled, terminalHighlightRules, terminalShellSyntaxEnabled, theme, transport]);

  useLayoutEffect(() => {
    const instance = terminal.current;
    const fitAddon = fit.current;
    if (!instance || !fitAddon) return;
    instance.options.theme = terminalThemes[theme];
    instance.options.fontSize = fontSize;
    if (active) requestAnimationFrame(() => fitAddon.fit());
  }, [active, fontSize, theme]);

  return <div className="terminal-host" ref={host} data-mrt-terminal-session-id={sessionId} aria-label={`${title} terminal output`} />;
}
