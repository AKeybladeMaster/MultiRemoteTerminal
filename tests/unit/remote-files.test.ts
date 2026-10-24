import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isRemoteDirectoryListing, isRemotePath, remoteChildPath, remoteParentPath
} from '../../packages/domain/src/remote-files.ts';

test('remote paths are bounded data and remote child names cannot escape a directory', () => {
  assert.equal(isRemotePath('/home/alice'), true);
  assert.equal(isRemotePath(''), false);
  assert.equal(isRemotePath('x\0y'), false);
  assert.equal(isRemotePath('x'.repeat(4_097)), false);
  assert.equal(remoteChildPath('/home/alice', 'report.txt'), '/home/alice/report.txt');
  assert.equal(remoteChildPath('/home/alice', '../outside'), undefined);
  assert.equal(remoteChildPath('/home/alice', 'a/b'), undefined);
  assert.equal(remoteParentPath('/home/alice/docs/'), '/home/alice');
  assert.equal(remoteParentPath('/'), '/');
});

test('remote listings accept bounded file metadata and reject malformed or oversized results', () => {
  const listing = { path: '/home/alice', truncated: false, entries: [
    { name: 'documents', path: '/home/alice/documents', kind: 'directory', size: 0, modifiedAt: 1_800_000_000 },
    { name: 'shortcut', path: '/home/alice/shortcut', kind: 'symlink', size: 8, modifiedAt: null }
  ] };
  assert.equal(isRemoteDirectoryListing(listing), true);
  assert.equal(isRemoteDirectoryListing({ ...listing, entries: [{ ...listing.entries[0], path: 'C:\\outside' }] }), false);
  assert.equal(isRemoteDirectoryListing({ ...listing, entries: [
    ...listing.entries, ...Array.from({ length: 499 }, (_, index) => ({ ...listing.entries[0], name: `f${index}`, path: `/home/alice/f${index}` }))
  ] }), false);
});
