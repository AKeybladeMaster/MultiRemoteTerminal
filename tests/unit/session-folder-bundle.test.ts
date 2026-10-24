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

test('version-2 bundles import credential-free version-1 profiles and reject unsupported version-1 FTP entries', () => {
  const bundle = validBundle();
  const legacy = { ...bundle, version: 1 };
  assert.equal(isSessionFolderBundle(legacy), false, 'the type guard narrows only current-version bundle objects');
  assert.equal(isSessionFolderBundle(bundle), true);
  assert.deepEqual(normalizeSessionFolderBundle(legacy), bundle);
  const ftpSession = { id: '66666666-6666-4666-8666-666666666666', folderId: childId, kind: 'ftp', name: 'Archive server',
    host: 'files.example.net', port: 2121, secure: true, favorite: false, createdAt: timestamp, updatedAt: timestamp } as const;
  assert.equal(normalizeSessionFolderBundle({ ...legacy, sessions: [...bundle.sessions, ftpSession] }), undefined);
});

test('session-folder bundles reject unsupported shape, secret-bearing records and unknown fields', () => {
  const bundle = validBundle();
  assert.equal(normalizeSessionFolderBundle({ ...bundle, extra: 'value' }), undefined);
  assert.equal(normalizeSessionFolderBundle({ ...bundle, version: 3 }), undefined);
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
