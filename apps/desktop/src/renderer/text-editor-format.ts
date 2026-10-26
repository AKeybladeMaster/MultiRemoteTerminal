export function textareaContent(content: string): string { return content.replace(/\r\n|\r/g, '\n'); }

export function fileLineEnding(content: string): string { return content.match(/\r\n|\r|\n/)?.[0] ?? '\n'; }

export function hasMixedLineEndings(content: string): boolean {
  const endings = content.match(/\r\n|\r|\n/g) ?? [];
  return new Set(endings).size > 1;
}

export function lineEndingLabel(ending: string): string {
  return ending === '\r\n' ? 'CRLF' : ending === '\r' ? 'CR' : 'LF';
}
