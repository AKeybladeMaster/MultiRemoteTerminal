export type TerminalTheme = 'dark' | 'light';

interface TerminalPalette {
  readonly background: string;
  readonly foreground: string;
  readonly cursor: string;
  readonly cursorAccent: string;
  readonly selectionBackground: string;
  readonly black: string;
  readonly red: string;
  readonly green: string;
  readonly yellow: string;
  readonly blue: string;
  readonly magenta: string;
  readonly cyan: string;
  readonly white: string;
  readonly brightBlack: string;
  readonly brightRed: string;
  readonly brightGreen: string;
  readonly brightYellow: string;
  readonly brightBlue: string;
  readonly brightMagenta: string;
  readonly brightCyan: string;
  readonly brightWhite: string;
}

export const terminalThemes = {
  dark: {
    background: '#101c28', foreground: '#e7edf4', cursor: '#f5ce85', cursorAccent: '#142231',
    selectionBackground: '#38546f', black: '#788899', red: '#ff6868', green: '#5fe08a', yellow: '#f8d36b',
    blue: '#69aafc', magenta: '#df8fff', cyan: '#54d7d4', white: '#e7edf4',
    brightBlack: '#98a6b4', brightRed: '#ff8989', brightGreen: '#84f2a7', brightYellow: '#ffe29a',
    brightBlue: '#96c2ff', brightMagenta: '#f1b3ff', brightCyan: '#80e6e3', brightWhite: '#ffffff'
  },
  light: {
    background: '#fbfcfe', foreground: '#182a3d', cursor: '#825600', cursorAccent: '#ffffff',
    selectionBackground: '#c3d8ee', black: '#52687e', red: '#a53232', green: '#267345', yellow: '#825600',
    blue: '#275b96', magenta: '#6d4388', cyan: '#216c70', white: '#52687e',
    brightBlack: '#43596f', brightRed: '#8d2525', brightGreen: '#185c36', brightYellow: '#6d4900',
    brightBlue: '#174c85', brightMagenta: '#583574', brightCyan: '#14585c', brightWhite: '#273b50'
  }
} satisfies Record<TerminalTheme, TerminalPalette>;
