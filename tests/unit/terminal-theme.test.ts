import assert from 'node:assert/strict';
import test from 'node:test';
import { terminalThemes } from '../../apps/desktop/src/renderer/terminal-theme.ts';

const ANSI_COLORS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
] as const satisfies readonly (keyof (typeof terminalThemes)['dark'])[];

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/.{2}/g)?.map(channel => Number.parseInt(channel, 16) / 255);
  assert.ok(channels?.length === 3, `expected a six-digit color, received ${hex}`);
  const [red, green, blue] = channels.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

test('ANSI colors remain readable on both terminal backgrounds', () => {
  for (const [name, theme] of Object.entries(terminalThemes)) {
    assert.match(theme.background ?? '', /^#[0-9a-f]{6}$/i, `${name} background must be opaque RGB`);
    for (const key of ANSI_COLORS) {
      const color = theme[key];
      assert.match(typeof color === 'string' ? color : '', /^#[0-9a-f]{6}$/i, `${name}.${key} must be opaque RGB`);
      assert.ok(contrastRatio(color as string, theme.background!) >= 4.5,
        `${name}.${key} falls below 4.5:1 terminal text contrast`);
    }
  }
});
