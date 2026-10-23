import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSshTransportProvider } from '../../apps/desktop/src/workers/ssh-transport-provider.ts';
import type { SshTransportClient, SshTransportClientFactory } from '../../apps/desktop/src/workers/ssh-transport-provider.ts';
import type { LocalTerminalEvent } from '../../packages/application/src/local-terminals.ts';
import { canonicalizeSshHostEndpoint } from '../../packages/domain/src/host-trust.ts';

const rawFixture = {
  host: process.env.MRT_TEST_SSH_HOST,
  port: process.env.MRT_TEST_SSH_PORT,
  username: process.env.MRT_TEST_SSH_USERNAME,
  password: process.env.MRT_TEST_SSH_PASSWORD,
  fingerprint: process.env.MRT_TEST_SSH_FINGERPRINT
};
const configured = Object.values(rawFixture).some(value => value !== undefined);
const complete = Object.values(rawFixture).every(value => typeof value === 'string' && value.length > 0);

test('password SSH transport accepts a verified disposable OpenSSH fixture and fails closed on bad credentials or key', {
  skip: configured ? false : 'Set MRT_TEST_SSH_HOST, PORT, USERNAME, PASSWORD and FINGERPRINT to run the disposable OpenSSH acceptance test',
  timeout: 60_000
}, async () => {
  if (!complete) throw new Error('OpenSSH fixture configuration is incomplete');
  const endpoint = canonicalizeSshHostEndpoint({ host: rawFixture.host, port: Number(rawFixture.port) });
  if (!endpoint || endpoint.host !== rawFixture.host || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(rawFixture.fingerprint!)) {
    throw new Error('OpenSSH fixture endpoint or fingerprint is invalid');
  }
  const ssh2 = createRequire(resolve('apps/desktop/package.json'))('ssh2') as {
    Client: new () => SshTransportClient;
    utils: { parseKey: SshTransportClientFactory['parseHostKey'] };
  };
  const clients: SshTransportClientFactory = { create: () => new ssh2.Client(), parseHostKey: ssh2.utils.parseKey };
  const credentials = { username: rawFixture.username!, password: rawFixture.password! };
  const size = { columns: 80, rows: 24 };

  const acceptedEvents: LocalTerminalEvent[] = [];
  const accepted = createSshTransportProvider(clients, event => acceptedEvents.push(event));
  const sessionId = randomUUID();
  try {
    await accepted.open(sessionId, endpoint, credentials, size, async evidence => evidence.fingerprint === rawFixture.fingerprint);
    await accepted.write(sessionId, 'echo MRT-OPENSSH-ACCEPT\r');
    await waitForTerminalOutput(acceptedEvents, sessionId, 'MRT-OPENSSH-ACCEPT');
    await accepted.close(sessionId);
    await assert.rejects(accepted.write(sessionId, 'echo CLOSED\r'), error => (error as { code?: string }).code === 'UNAVAILABLE');
  } finally {
    await accepted.shutdown();
  }

  const wrongKey = createSshTransportProvider(clients, () => {});
  try {
    await assert.rejects(wrongKey.open(randomUUID(), endpoint, credentials, size, async () => false),
      error => (error as { code?: string }).code === 'HOST_KEY_REJECTED');
  } finally {
    await wrongKey.shutdown();
  }

  const wrongPassword = createSshTransportProvider(clients, () => {});
  const failedSessionId = randomUUID();
  try {
    await assert.rejects(wrongPassword.open(failedSessionId, endpoint,
      { username: credentials.username, password: `${credentials.password}__invalid` }, size, async evidence => evidence.fingerprint === rawFixture.fingerprint),
    error => (error as { code?: string }).code === 'AUTHENTICATION_FAILED');
    await assert.rejects(wrongPassword.write(failedSessionId, 'echo CLOSED\r'),
      error => (error as { code?: string }).code === 'UNAVAILABLE');
  } finally {
    await wrongPassword.shutdown();
  }
});

async function waitForTerminalOutput(events: readonly LocalTerminalEvent[], sessionId: string, marker: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const current = events.filter(event => event.sessionId === sessionId);
    const failure = current.find(event => event.kind === 'failure');
    if (failure?.kind === 'failure') throw new Error(`OpenSSH terminal failed (${failure.error.code})`);
    if (current.some(event => event.kind === 'data' && event.data.includes(marker))) return;
    await new Promise(resolvePoll => setTimeout(resolvePoll, 25));
  }
  throw new Error('OpenSSH shell did not return the probe marker');
}
