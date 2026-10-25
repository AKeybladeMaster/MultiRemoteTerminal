export function textareaContent(content: string): string { return content.replace(/\r\n|\r/g, '\n'); }

export function fileLineEnding(content: string): string { return content.match(/\r\n|\r|\n/)?.[0] ?? '\n'; }
