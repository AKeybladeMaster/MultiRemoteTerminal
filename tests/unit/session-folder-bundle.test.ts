import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionFolderBundle, normalizeSessionFolderBundle, SESSION_FOLDER_BUNDLE_FORMAT, SESSION_FOLDER_BUNDLE_VERSION } from '../../packages/domain/src/session-folder-bundle.ts';

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

test('session-folder bundles reject unsupported shape, secret-bearing records and unknown fields', () => {
  const bundle = validBundle();
  assert.equal(normalizeSessionFolderBundle({ ...bundle, extra: 'value' }), undefined);
  assert.equal(normalizeSessionFolderBundle({ ...bundle, version: 2 }), undefined);
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
