import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionFolderBundle, isSessionFolderBundle, normalizeSessionFolderBundle, SESSION_FOLDER_BUNDLE_FORMAT, SESSION_FOLDER_BUNDLE_VERSION } from '../../packages/domain/src/session-folder-bundle.ts';

const rootId = '11111111-1111-4111-8111-111111111111';
const childId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const timestamp = '2026-10-24T12:00:00.000Z';

function validBundle() {
  return {
    format: SESSION_FOLDER_BUNDLE_FORMAT,
    version: SESSION_FOLDER_BUNDLE_VERSION,
    rootFolderId: rootId,
    exportedAt: timestamp,
    folders: [
      { id: rootId, parentId: null, name: 'Project' },
      { id: childId, parentId: rootId, name: 'Lab' }
    ],
    sessions: [{ id: sessionId, folderId: childId, kind: 'local', name: 'PowerShell', shell: 'powershell', favorite: true,
      createdAt: timestamp, updatedAt: timestamp }]
  } as const;
}

test('session-folder bundles preserve only validated folder and session metadata', () => {
  const value = validBundle();
  assert.deepEqual(normalizeSessionFolderBundle(value), value);
  assert.deepEqual(createSessionFolderBundle({ rootFolderId: rootId, folders: value.folders, sessions: value.sessions, exportedAt: timestamp }), value);
});

test('session-folder bundles preserve FTP security mode without account credentials', () => {
  const bundle = validBundle();
  const ftpSession = { id: '66666666-6666-4666-8666-666666666666', folderId: childId, kind: 'ftp', name: 'Archive server',
    host: 'files.example.net', port: 2121, secure: true, favorite: false, createdAt: timestamp, updatedAt: timestamp } as const;
  const value = { ...bundle, sessions: [...bundle.sessions, ftpSession] };
  assert.deepEqual(normalizeSessionFolderBundle(value), value);
  assert.equal(normalizeSessionFolderBundle({ ...value, sessions: [...value.sessions.slice(0, 1), { ...ftpSession, password: 'secret' }] }), undefined);
});

test('session-folder bundles include standalone SFTP profiles without credentials', () => {
  const bundle = validBundle();
  const sftpSession = { id: '77777777-7777-4777-8777-777777777777', folderId: childId, kind: 'sftp', name: 'Build files',
    host: 'ssh.example.net', port: 22, favorite: false, createdAt: timestamp, updatedAt: timestamp } as const;
  const value = { ...bundle, sessions: [...bundle.sessions, sftpSession] };
  assert.deepEqual(normalizeSessionFolderBundle(value), value);
  assert.equal(normalizeSessionFolderBundle({ ...value, sessions: [...value.sessions.slice(0, 1), { ...sftpSession, privateKey: 'secret' }] }), undefined);
});

test('version-7 session-folder bundles include WSL profiles and preserve version-6 behavior', () => {
  const bundle = validBundle();
  const rdpSession = { id: '88888888-8888-4888-8888-888888888888', folderId: childId, kind: 'rdp', name: 'Windows desktop',
    host: 'desktop.example.net', port: 3390, favorite: false, createdAt: timestamp, updatedAt: timestamp } as const;
  const value = { ...bundle, sessions: [...bundle.sessions, rdpSession] };
  assert.deepEqual(normalizeSessionFolderBundle(value), value);
  assert.equal(normalizeSessionFolderBundle({ ...value, sessions: [...value.sessions.slice(0, 1), { ...rdpSession, password: 'secret' }] }), undefined);
  assert.equal(normalizeSessionFolderBundle({ ...value, version: 3 }), undefined, 'version 3 predates RDP profile support');
  const vncSession = { id: '99999999-9999-4999-8999-999999999999', folderId: childId, kind: 'vnc', name: 'Linux desktop',
    host: 'desktop.example.net', port: 5901, favorite: false, createdAt: timestamp, updatedAt: timestamp } as const;
  const withVnc = { ...value, sessions: [...value.sessions, vncSession] };
  assert.deepEqual(normalizeSessionFolderBundle(withVnc), withVnc);
  assert.equal(normalizeSessionFolderBundle({ ...withVnc, sessions: [...withVnc.sessions.slice(0, -1), { ...vncSession, password: 'secret' }] }), undefined);
  assert.equal(normalizeSessionFolderBundle({ ...withVnc, version: 4 }), undefined, 'version 4 predates VNC profile support');

  const serialSession = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', folderId: childId, kind: 'serial', name: 'Controller COM7',
    configuration: { path: 'COM7', baudRate: 115_200, dataBits: 8, parity: 'even', stopBits: 1, flowControl: 'rtscts' },
    favorite: false, createdAt: timestamp, updatedAt: timestamp } as const;
  const withSerial = { ...withVnc, sessions: [...withVnc.sessions, serialSession] };
  assert.deepEqual(normalizeSessionFolderBundle(withSerial), withSerial);
  assert.equal(normalizeSessionFolderBundle({ ...withSerial, sessions: [...withSerial.sessions.slice(0, -1),
    { ...serialSession, configuration: { ...serialSession.configuration, path: 'COM4096' } }] }), undefined);
  assert.equal(normalizeSessionFolderBundle({ ...withSerial, sessions: [...withSerial.sessions.slice(0, -1),
    { ...serialSession, password: 'must-not-import' }] }), undefined);
  assert.equal(normalizeSessionFolderBundle({ ...withSerial, version: 5 }), undefined, 'version 5 predates serial profile support');
  const wslSession = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', folderId: childId, kind: 'local', name: 'Ubuntu', shell: 'wsl',
    distribution: 'Ubuntu', favorite: false, createdAt: timestamp, updatedAt: timestamp } as const;
  const withWsl = { ...withSerial, sessions: [...withSerial.sessions, wslSession] };
  assert.deepEqual(normalizeSessionFolderBundle(withWsl), withWsl);
  assert.equal(normalizeSessionFolderBundle({ ...withWsl, version: 6 }), undefined, 'version 6 predates WSL profile support');
  assert.equal(normalizeSessionFolderBundle({ ...withWsl, sessions: [...withWsl.sessions.slice(0, -1), { ...wslSession, distribution: ' Ubuntu' }] }), undefined);
});

test('version-7 bundles import versions 1 through 6 with their existing kind limits', () => {
  const bundle = validBundle();
  const legacyV1 = { ...bundle, version: 1 };
  const legacyV2 = { ...bundle, version: 2 };
  const legacyV3 = { ...bundle, version: 3 };
  const legacyV4 = { ...bundle, version: 4 };
  const legacyV5 = { ...bundle, version: 5 };
  const legacyV6 = { ...bundle, version: 6 };
  assert.equal(isSessionFolderBundle(legacyV1), false, 'the type guard narrows only current-version bundle objects');
  assert.equal(isSessionFolderBundle(bundle), true);
  assert.deepEqual(normalizeSessionFolderBundle(legacyV1), bundle);
  assert.deepEqual(normalizeSessionFolderBundle(legacyV2), bundle);
  assert.deepEqual(normalizeSessionFolderBundle(legacyV3), bundle);
  assert.deepEqual(normalizeSessionFolderBundle(legacyV4), bundle);
  assert.deepEqual(normalizeSessionFolderBundle(legacyV5), bundle);
  assert.deepEqual(normalizeSessionFolderBundle(legacyV6), bundle);
  const ftpSession = { id: '66666666-6666-4666-8666-666666666666', folderId: childId, kind: 'ftp', name: 'Archive server',
    host: 'files.example.net', port: 2121, secure: true, favorite: false, createdAt: timestamp, updatedAt: timestamp } as const;
  assert.equal(normalizeSessionFolderBundle({ ...legacyV1, sessions: [...bundle.sessions, ftpSession] }), undefined);
  const sftpSession = { id: '77777777-7777-4777-8777-777777777777', folderId: childId, kind: 'sftp', name: 'Build files',
    host: 'ssh.example.net', port: 22, favorite: false, createdAt: timestamp, updatedAt: timestamp } as const;
  assert.equal(normalizeSessionFolderBundle({ ...legacyV2, sessions: [...bundle.sessions, sftpSession] }), undefined);
  const rdpSession = { id: '88888888-8888-4888-8888-888888888888', folderId: childId, kind: 'rdp', name: 'Windows desktop',
    host: 'desktop.example.net', port: 3390, favorite: false, createdAt: timestamp, updatedAt: timestamp } as const;
  assert.equal(normalizeSessionFolderBundle({ ...legacyV3, sessions: [...bundle.sessions, rdpSession] }), undefined);
  const vncSession = { id: '99999999-9999-4999-8999-999999999999', folderId: childId, kind: 'vnc', name: 'Linux desktop',
    host: 'desktop.example.net', port: 5901, favorite: false, createdAt: timestamp, updatedAt: timestamp } as const;
  assert.equal(normalizeSessionFolderBundle({ ...legacyV4, sessions: [...bundle.sessions, vncSession] }), undefined);
  const serialSession = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', folderId: childId, kind: 'serial', name: 'Controller COM7',
    configuration: { path: 'COM7', baudRate: 115_200, dataBits: 8, parity: 'even', stopBits: 1, flowControl: 'rtscts' },
    favorite: false, createdAt: timestamp, updatedAt: timestamp } as const;
  assert.equal(normalizeSessionFolderBundle({ ...legacyV5, sessions: [...bundle.sessions, serialSession] }), undefined);
  assert.ok(normalizeSessionFolderBundle({ ...legacyV6, sessions: [...bundle.sessions, serialSession] }));
});

test('legacy session-folder bundle versions reject WSL profiles', () => {
  const bundle = validBundle();
  const wslSession = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', folderId: childId, kind: 'local', name: 'Ubuntu', shell: 'wsl',
    distribution: 'Ubuntu', favorite: false, createdAt: timestamp, updatedAt: timestamp } as const;
  const withWsl = { ...bundle, sessions: [...bundle.sessions, wslSession] };

  assert.deepEqual(normalizeSessionFolderBundle(withWsl), withWsl);
  for (const version of [1, 2, 3, 4, 5, 6]) {
    assert.equal(normalizeSessionFolderBundle({ ...withWsl, version }), undefined,
      `version ${version} predates WSL profile support`);
  }
});

test('session-folder bundles reject unsupported shape, secret-bearing records and unknown fields', () => {
  const bundle = validBundle();
  assert.equal(normalizeSessionFolderBundle({ ...bundle, extra: 'value' }), undefined);
  assert.equal(normalizeSessionFolderBundle({ ...bundle, version: 8 }), undefined);
  assert.equal(normalizeSessionFolderBundle({ ...bundle, sessions: [{ ...bundle.sessions[0], password: 'must-not-import' }] }), undefined);
  assert.equal(normalizeSessionFolderBundle({ ...bundle, exportedAt: 'yesterday' }), undefined);
});

test('session-folder bundles reject duplicate IDs/names, missing parents, cycles and detached trees', () => {
  const bundle = validBundle();
  assert.equal(normalizeSessionFolderBundle({ ...bundle, folders: [...bundle.folders, { id: childId, parentId: rootId, name: 'Other' }] }), undefined);
  assert.equal(normalizeSessionFolderBundle({ ...bundle, folders: [...bundle.folders, { id: sessionId, parentId: rootId, name: 'Lab' }] }), undefined);
  assert.equal(normalizeSessionFolderBundle({ ...bundle, folders: [{ ...bundle.folders[0], parentId: childId }, bundle.folders[1]] }), undefined);
  assert.equal(normalizeSessionFolderBundle({ ...bundle, folders: [bundle.folders[0], { ...bundle.folders[1], parentId: '44444444-4444-4444-8444-444444444444' }] }), undefined);
});

test('bundle sibling-name validation matches SQLite NOCASE for non-ASCII letters', () => {
  const bundle = validBundle();
  const unicodeSiblings = [
    { id: '44444444-4444-4444-8444-444444444444', parentId: rootId, name: 'Device Ä' },
    { id: '55555555-5555-4555-8555-555555555555', parentId: rootId, name: 'Device ä' }
  ];
  assert.ok(normalizeSessionFolderBundle({ ...bundle, folders: [...bundle.folders, ...unicodeSiblings] }));
  assert.equal(normalizeSessionFolderBundle({ ...bundle, folders: [...bundle.folders,
    { id: '44444444-4444-4444-8444-444444444444', parentId: rootId, name: 'Device' },
    { id: '55555555-5555-4555-8555-555555555555', parentId: rootId, name: 'device' }
  ] }), undefined);
});
