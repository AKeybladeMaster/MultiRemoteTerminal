import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeWslDistributionList, isWslDistributionName, parseWslDistributionList } from '../../packages/domain/src/wsl-distributions.ts';

test('WSL distribution parsing decodes UTF-16LE output while preserving names', () => {
  assert.deepEqual(decodeWslDistributionList(Buffer.from('\uFEFFUbuntu\r\nDebian Dev\r\n', 'utf16le')),
    [{ name: 'Ubuntu' }, { name: 'Debian Dev' }]);
  assert.deepEqual(parseWslDistributionList('\uFEFFUbuntu\r\nDebian-Dev\r\n'), [
    { name: 'Ubuntu' }, { name: 'Debian-Dev' }
  ]);
  assert.deepEqual(parseWslDistributionList(''), []);
});

test('WSL distribution names and list output are bounded and reject malformed entries', () => {
  assert.equal(isWslDistributionName('Debian Dev'), true);
  assert.equal(isWslDistributionName(' Ubuntu'), false);
  assert.equal(isWslDistributionName('Ubuntu\n--exec bash'), false);
  assert.equal(isWslDistributionName('Distro\uD800'), false);
  assert.equal(isWslDistributionName('Distro🙂'), true);
  assert.equal(isWslDistributionName(`Distro${String.fromCodePoint(0x1f642)}`), true);
  assert.equal(isWslDistributionName('x'.repeat(129)), false);
  assert.equal(parseWslDistributionList('Ubuntu\nubuntu'), undefined);
  assert.equal(decodeWslDistributionList(new Uint8Array([0xff, 0xfe, 0x55])), undefined);
  assert.equal(parseWslDistributionList('x'.repeat(65_537)), undefined);
  assert.equal(parseWslDistributionList(Array.from({ length: 129 }, (_, index) => `Distro${index}`).join('\n')), undefined);
});
