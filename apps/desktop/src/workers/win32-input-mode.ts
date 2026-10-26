const WIN32_INPUT_MODE_CHANGE = /\x1b\[\?9001([hl])/gu;
const WIN32_INPUT_MODE_PREFIX_LENGTH = 7;

/** Tracks the ConPTY keyboard mode requested through the terminal output stream. */
export class Win32InputModeTracker {
  private trailingOutput = '';
  private active = false;

  get enabled(): boolean {
    return this.active;
  }

  observeOutput(data: string): void {
    const combined = this.trailingOutput + data;
    for (const match of combined.matchAll(WIN32_INPUT_MODE_CHANGE)) this.active = match[1] === 'h';
    this.trailingOutput = combined.slice(-WIN32_INPUT_MODE_PREFIX_LENGTH);
  }
}

/** Encodes supplementary clipboard characters as UTF-16 Win32 key records. */
export function encodeSupplementaryCharactersForWin32Input(data: string): string {
  let encoded = '';
  for (let index = 0; index < data.length; index++) {
    const high = data.charCodeAt(index);
    if (high < 0xd800 || high > 0xdbff) {
      encoded += data.slice(index, index + 1);
      continue;
    }

    const low = data.charCodeAt(index + 1);
    if (index + 1 >= data.length || low < 0xdc00 || low > 0xdfff) {
      encoded += data.slice(index, index + 1);
      continue;
    }

    encoded += `\x1b[;;${high};1_\x1b[;;${low};1_`;
    index++;
  }
  return encoded;
}
