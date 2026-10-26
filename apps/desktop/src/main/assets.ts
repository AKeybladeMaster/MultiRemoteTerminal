import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// xterm.js installs its parsed-color and decoration styles in runtime <style> elements.
// Keep inline scripts blocked; only the style policy permits generated inline CSS.
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'none'";

export function assetPath(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'mrt:' || url.hostname !== 'app' || url.port || url.username || url.password || url.search || url.hash) return;
    if (url.pathname === '/index.html' || /^\/assets\/[a-zA-Z0-9_-]+\.(js|css)$/.test(url.pathname)) return url.pathname.slice(1);
  } catch { /* Malformed URL is denied. */ }
}

export async function serveAsset(root: string, request: Request): Promise<Response> {
  const path = assetPath(request.url);
  const headers = { 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
  if (request.method !== 'GET' || !path) return new Response(null, { status: 403, headers });
  try {
    const bytes = await readFile(join(root, path));
    const type = path.endsWith('.html') ? 'text/html; charset=utf-8' : path.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8';
    return new Response(bytes, { headers: { ...headers, 'Content-Type': type } });
  } catch {
    return new Response(null, { status: 404, headers });
  }
}
