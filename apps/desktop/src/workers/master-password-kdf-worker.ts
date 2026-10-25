import { deriveMasterPasswordKey } from './master-password-kdf.ts';

const parent = process.parentPort;
if (!parent) throw new Error('Master-password KDF requires an Electron utility process');

let received = false;
parent.on('message', event => {
  if (received) return;
  received = true;
  void derive(event.data);
});

async function derive(input: unknown): Promise<void> {
  if (!isRequest(input)) return;
  const password = new Uint8Array(input.password);
  const salt = new Uint8Array(input.salt);
  let key: Buffer | undefined;
  try {
    key = await deriveMasterPasswordKey(password, salt);
    parent.postMessage({ version: 1, type: 'result', requestId: input.requestId, key: new Uint8Array(key) });
  } catch {
    parent.postMessage({ version: 1, type: 'error', requestId: input.requestId });
  } finally {
    password.fill(0);
    salt.fill(0);
    key?.fill(0);
  }
}

function isRequest(value: unknown): value is { readonly version: 1; readonly type: 'derive'; readonly requestId: string; readonly password: Uint8Array; readonly salt: Uint8Array } {
  return isRecord(value) && Object.keys(value).length === 5 && value.version === 1 && value.type === 'derive' &&
    typeof value.requestId === 'string' && /^[0-9a-f-]{36}$/i.test(value.requestId) &&
    value.password instanceof Uint8Array && value.password.byteLength > 0 && value.password.byteLength <= 1024 &&
    value.salt instanceof Uint8Array && value.salt.byteLength === 16;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
