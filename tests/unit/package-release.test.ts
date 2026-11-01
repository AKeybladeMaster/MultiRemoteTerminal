import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { access, link, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertReleaseSigners, assertUnsignedReleaseArtifacts, expectedReleaseSigner, signedReleaseRequested } from '../../scripts/release-signature-policy.mjs';
import {
  buildThirdPartyNotices, ensureWorkspaceOutputDirectory, ensureWorkspaceTemporaryDirectory, productionLicensePackages,
  productionPackageIntegrityIndex, publicPackageDistributionUrl, readBoundedLockfile, readBoundedRegularFile, readInstalledPackageManifest,
  sha256RegularFile, writeWorkspaceOutputFile, writeWorkspaceTemporaryNoticeFile
} from '../../scripts/third-party-notices.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('release workspace avoids dependency hard links so bounded package readers can inspect pnpm installs', async () => {
  const workspaceConfig = await readFile(join(workspaceRoot, 'pnpm-workspace.yaml'), 'utf8');
  assert.match(workspaceConfig, /^packageImportMethod:\s*clone-or-copy\s*$/mu);
});

test('release signature policy pins every artifact to the expected certificate', () => {
  assert.equal(signedReleaseRequested(undefined), false);
  assert.equal(signedReleaseRequested('0'), false);
  assert.equal(signedReleaseRequested('1'), true);
  assert.throws(() => signedReleaseRequested('true'), /must be unset, 0, or 1/u);
  const expected = expectedReleaseSigner('0123456789abcdef0123456789abcdef01234567');
  assert.equal(expected, '0123456789ABCDEF0123456789ABCDEF01234567');
  assert.doesNotThrow(() => assertReleaseSigners([
    { file: 'installer.exe', status: 'Valid', signerThumbprint: expected.toLowerCase() },
    { file: 'portable.exe', status: 'Valid', signerThumbprint: expected }
  ], ['installer.exe', 'portable.exe'], expected));
  assert.throws(() => assertReleaseSigners([
    { file: 'installer.exe', status: 'Valid', signerThumbprint: '89abcdef012345670123456789abcdef01234567' }
  ], ['installer.exe'], expected), /MRT_RELEASE_SIGNER_SHA1/u);
  assert.throws(() => assertReleaseSigners([
    { file: 'installer.exe', status: 'NotSigned', signerThumbprint: null }
  ], ['installer.exe'], expected), /MRT_RELEASE_SIGNER_SHA1/u);
  assert.throws(() => assertReleaseSigners([
    { file: 'portable.exe', status: 'Valid', signerThumbprint: expected },
    { file: 'installer.exe', status: 'Valid', signerThumbprint: expected }
  ], ['installer.exe', 'portable.exe'], expected), /MRT_RELEASE_SIGNER_SHA1/u);
  assert.throws(() => expectedReleaseSigner('publisher-name'), /40-character certificate thumbprint/u);
  assert.throws(() => expectedReleaseSigner(undefined), /40-character certificate thumbprint/u);
  assert.doesNotThrow(() => assertUnsignedReleaseArtifacts([
    { file: 'installer.exe', status: 'NotSigned' },
    { file: 'portable.exe', status: 'NotSigned' }
  ], ['installer.exe', 'portable.exe']));
  assert.throws(() => assertUnsignedReleaseArtifacts([
    { file: 'installer.exe', status: 'Valid', signerThumbprint: expected }
  ], ['installer.exe']), /only the expected unsigned artifacts/u);
  assert.throws(() => assertUnsignedReleaseArtifacts([
    { file: 'installer.exe', status: 'NotSigned', signerSubject: 'CN=unexpected signer' }
  ], ['installer.exe']), /only the expected unsigned artifacts/u);
  assert.throws(() => assertUnsignedReleaseArtifacts([
    { file: 'portable.exe', status: 'NotSigned' },
    { file: 'installer.exe', status: 'NotSigned' }
  ], ['installer.exe', 'portable.exe']), /only the expected unsigned artifacts/u);
});

test('workspace-generated output stays inside real workspace directories', async context => {
  const temporaryRoot = await ensureWorkspaceTemporaryDirectory(workspaceRoot);
  const projectRoot = await mkdtemp(join(temporaryRoot, 'mrt-notice-output-root-'));
  const canonicalProjectRoot = await realpath(projectRoot);
  const outsideRoot = await mkdtemp(join(temporaryRoot, 'mrt-notice-output-outside-'));
  const linkedRoot = join(canonicalProjectRoot, '.tmp');
  try {
    assert.equal(await ensureWorkspaceOutputDirectory(projectRoot, []), canonicalProjectRoot);
    assert.equal(await ensureWorkspaceTemporaryDirectory(projectRoot), linkedRoot);
    const noticeOutput = join(linkedRoot, 'THIRD-PARTY-NOTICES.txt');
    assert.equal(await writeWorkspaceTemporaryNoticeFile(projectRoot, 'initial notice'), noticeOutput);
    assert.equal(await readFile(noticeOutput, 'utf8'), 'initial notice');
    await writeWorkspaceTemporaryNoticeFile(projectRoot, 'updated notice');
    assert.equal(await readFile(noticeOutput, 'utf8'), 'updated notice');
    const artifactsRoot = join(canonicalProjectRoot, 'artifacts');
    const windowsArtifacts = join(artifactsRoot, 'windows');
    assert.equal(await ensureWorkspaceOutputDirectory(projectRoot, ['artifacts', 'windows']), windowsArtifacts);
    await assert.rejects(ensureWorkspaceOutputDirectory(projectRoot, ['..', 'outside']), /bounded simple names/u);
    await assert.rejects(writeWorkspaceOutputFile(projectRoot, ['artifacts', 'windows'], '../outside.cdx.json', 'invalid path'),
      /output name is invalid/u);
    const sbomOutput = join(windowsArtifacts, 'bundle.cdx.json');
    assert.equal(await writeWorkspaceOutputFile(projectRoot, ['artifacts', 'windows'], 'bundle.cdx.json', 'initial SBOM'), sbomOutput);
    assert.equal(await readFile(sbomOutput, 'utf8'), 'initial SBOM');
    await writeWorkspaceOutputFile(projectRoot, ['artifacts', 'windows'], 'bundle.cdx.json', 'updated SBOM');
    assert.equal(await readFile(sbomOutput, 'utf8'), 'updated SBOM');
    assert.deepEqual((await readdir(windowsArtifacts)).sort(), ['bundle.cdx.json']);
    await rm(artifactsRoot, { recursive: true, force: true });
    try { await symlink(outsideRoot, artifactsRoot, process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') { context.skip('The current account cannot create a directory link.'); return; }
      throw error;
    }
    await assert.rejects(ensureWorkspaceOutputDirectory(projectRoot, ['artifacts', 'windows']), /real directories inside the workspace/u);
    await rm(artifactsRoot, { recursive: true, force: true });
    const outsideFile = join(outsideRoot, 'sentinel.txt');
    await writeFile(outsideFile, 'leave outside unchanged', 'utf8');
    await mkdir(windowsArtifacts, { recursive: true });
    const linkedSbomOutput = join(windowsArtifacts, 'bundle.cdx.json');
    try { await symlink(outsideFile, linkedSbomOutput, 'file'); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') { context.skip('The current account cannot create a file link.'); return; }
      throw error;
    }
    await assert.rejects(writeWorkspaceOutputFile(projectRoot, ['artifacts', 'windows'], 'bundle.cdx.json', 'replacement SBOM'),
      /regular, unlinked workspace file/u);
    assert.equal(await readFile(outsideFile, 'utf8'), 'leave outside unchanged');
    await rm(linkedSbomOutput);
    const hardLinkedSbomOutput = join(windowsArtifacts, 'hard-linked.cdx.json');
    try { await link(outsideFile, hardLinkedSbomOutput); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP' || code === 'EXDEV') {
        context.skip('The current account cannot create a workspace test hard link.'); return;
      }
      throw error;
    }
    await assert.rejects(writeWorkspaceOutputFile(projectRoot, ['artifacts', 'windows'], 'hard-linked.cdx.json', 'replacement SBOM'),
      /regular, unlinked workspace file/u);
    assert.equal(await readFile(outsideFile, 'utf8'), 'leave outside unchanged');
    const linkedOutput = join(linkedRoot, 'THIRD-PARTY-NOTICES.txt');
    try { await symlink(outsideFile, linkedOutput, 'file'); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') { context.skip('The current account cannot create a file link.'); return; }
      throw error;
    }
    await assert.rejects(writeWorkspaceTemporaryNoticeFile(projectRoot, 'new notice'), /regular, unlinked workspace file/u);
    assert.equal(await readFile(outsideFile, 'utf8'), 'leave outside unchanged');
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});
test('production notice aggregation includes license and notice text and rejects missing files', async () => {
  const excessInventory = Array.from({ length: 513 }, (_, index) => `${index}.0.0`);
  assert.throws(() => productionLicensePackages({ MIT: [{ name: 'sample-package', license: 'MIT', versions: excessInventory,
    paths: excessInventory.map(() => 'node_modules/sample-package') }] }), /exceeds its bound/u);
  assert.throws(() => productionLicensePackages({ MIT: [{ name: 'p'.repeat(513), license: 'MIT', versions: ['1.0.0'],
    paths: ['node_modules/sample-package'] }] }), /incomplete production package license record/u);
  assert.throws(() => productionLicensePackages({ MIT: [{ name: 'sample-package', license: 'MIT', versions: ['1.0.0'],
    paths: ['p'.repeat(32_768)] }] }), /invalid license path/u);
  assert.throws(() => productionLicensePackages({ MIT: [{ name: 'sample-package', license: 'MIT', versions: ['1.0.0'],
    paths: ['node_modules/sample-package'] }], ISC: [{ name: 'sample-package', license: 'ISC', versions: ['1.0.0'],
    paths: ['node_modules/another-sample-package'] }] }), /conflicting production licenses/u);

  const temporaryRoot = await ensureWorkspaceTemporaryDirectory(workspaceRoot);
  const temporaryDirectory = await mkdtemp(join(temporaryRoot, 'mrt-third-party-notices-'));
  const dependencyRoot = join(temporaryDirectory, 'node_modules');
  const packagePath = join(dependencyRoot, 'sample-package');
  try {
    await mkdir(packagePath, { recursive: true });
    await writeFile(join(packagePath, 'package.json'), JSON.stringify({ name: 'sample-package', version: '1.2.3' }), 'utf8');
    await writeFile(join(packagePath, 'LICENSE-MIT.txt'), 'MIT License\nPermission is granted.\n', 'utf8');
    await writeFile(join(packagePath, 'NOTICE'), 'Sample notice.\n', 'utf8');
    await writeFile(join(packagePath, 'THIRD-PARTY-NOTICES.md'), 'Bundled downstream notice.\n', 'utf8');
    const packages = productionLicensePackages({ MIT: [{
      name: 'sample-package', versions: ['1.2.3'], paths: [packagePath], license: 'MIT'
    }] });
    const packageMetadata = await readInstalledPackageManifest(packagePath, dependencyRoot);
    assert.equal(packageMetadata.manifest.name, 'sample-package');
    assert.equal(packageMetadata.manifest.version, '1.2.3');
    await assert.rejects(readInstalledPackageManifest(temporaryDirectory, dependencyRoot), /outside node_modules/u);
    const notices = await buildThirdPartyNotices(packages, dependencyRoot);
    assert.match(notices, /sample-package@1\.2\.3/u);
    assert.match(notices, /MIT License/u);
    assert.match(notices, /Sample notice\./u);
    assert.match(notices, /Bundled downstream notice\./u);
    await assert.rejects(buildThirdPartyNotices([
      { name: 'different-package', version: '1.2.3', license: 'MIT', path: packagePath }
    ], dependencyRoot), /metadata does not match/u);
    await assert.rejects(buildThirdPartyNotices([
      { name: 'sample-package\u001b[2J', version: '1.2.3', license: 'MIT', path: packagePath }
    ], dependencyRoot), /invalid notice metadata/u);
    await assert.rejects(buildThirdPartyNotices([
      { name: 'sample-package\u202e', version: '1.2.3', license: 'MIT', path: packagePath }
    ], dependencyRoot), /invalid notice metadata/u);
    await assert.rejects(buildThirdPartyNotices([
      { name: 'p'.repeat(513), version: '1.2.3', license: 'MIT', path: packagePath }
    ], dependencyRoot), /invalid notice metadata/u);
    await assert.rejects(buildThirdPartyNotices([
      { name: 'outside', version: '1.0.0', license: 'MIT', path: temporaryDirectory }
    ], dependencyRoot), /outside node_modules/u);

    const oversizedManifestPackage = join(dependencyRoot, 'oversized-manifest-package');
    await mkdir(oversizedManifestPackage, { recursive: true });
    await writeFile(join(oversizedManifestPackage, 'package.json'), ' '.repeat(1024 * 1024 + 1), 'utf8');
    await writeFile(join(oversizedManifestPackage, 'LICENSE'), 'MIT License\n', 'utf8');
    await assert.rejects(readInstalledPackageManifest(oversizedManifestPackage, dependencyRoot), /metadata is missing or invalid/u);
    await assert.rejects(buildThirdPartyNotices([
      { name: 'oversized-manifest-package', version: '1.0.0', license: 'MIT', path: oversizedManifestPackage }
    ], dependencyRoot), /metadata.*missing or invalid/u);

    const oversizedDirectoryPackage = join(dependencyRoot, 'oversized-directory-package');
    await mkdir(oversizedDirectoryPackage, { recursive: true });
    await writeFile(join(oversizedDirectoryPackage, 'package.json'), JSON.stringify({ name: 'oversized-directory-package', version: '1.0.0' }), 'utf8');
    for (let index = 0; index < 4097; index += 1) await writeFile(join(oversizedDirectoryPackage, `file-${index}.txt`), '');
    await assert.rejects(buildThirdPartyNotices([
      { name: 'oversized-directory-package', version: '1.0.0', license: 'MIT', path: oversizedDirectoryPackage }
    ], dependencyRoot), /package directory.*exceeds its entry limit/u);

    const oversizedLicense = join(packagePath, 'LICENSE-oversized.txt');
    await writeFile(oversizedLicense, Buffer.alloc(1024 * 1024 + 1, 0x61));
    await assert.rejects(buildThirdPartyNotices(packages, dependencyRoot), /LICENSE-oversized\.txt.*oversized/u);
    await rm(oversizedLicense, { force: true });

    const deceptiveLicenseName = join(packagePath, 'LICENSE\u202e.txt');
    await writeFile(deceptiveLicenseName, 'Misleading filename.\n', 'utf8');
    await assert.rejects(buildThirdPartyNotices(packages, dependencyRoot), /license filename.*control or format characters/u);
    await rm(deceptiveLicenseName, { force: true });

    const emptyPackage = join(dependencyRoot, 'empty-package');
    await mkdir(emptyPackage);
    await writeFile(join(emptyPackage, 'package.json'), JSON.stringify({ name: 'empty-package', version: '1.0.0' }), 'utf8');
    await assert.rejects(buildThirdPartyNotices([
      { name: 'empty-package', version: '1.0.0', license: 'MIT', path: emptyPackage }
    ], dependencyRoot), /No license or notice/u);

    for (const nested of [
      { name: 'cpu-features', version: '0.0.10', file: 'deps/cpu_features/LICENSE', text: 'Nested Apache license text.' },
      { name: 'node-pty', version: '1.1.0', file: 'deps/winpty/LICENSE', text: 'Nested WinPTY attribution.' }
    ]) {
      const nestedPackagePath = join(dependencyRoot, nested.name);
      const nestedLicensePath = join(nestedPackagePath, ...nested.file.split('/'));
      await mkdir(nestedPackagePath, { recursive: true });
      await mkdir(dirname(nestedLicensePath), { recursive: true });
      await writeFile(join(nestedPackagePath, 'package.json'), JSON.stringify({ name: nested.name, version: nested.version }), 'utf8');
      await writeFile(join(nestedPackagePath, 'LICENSE'), 'Package-level MIT license.\n', 'utf8');
      await writeFile(nestedLicensePath, `${nested.text}\n`, 'utf8');
      const result = await buildThirdPartyNotices([
        { name: nested.name, version: nested.version, license: 'MIT', path: nestedPackagePath }
      ], dependencyRoot);
      assert.ok(result.includes(`--- ${nested.file} ---\n${nested.text}\n`));
      const changedVersionPath = join(dependencyRoot, `${nested.name}-changed-version`);
      await mkdir(changedVersionPath, { recursive: true });
      await writeFile(join(changedVersionPath, 'package.json'), JSON.stringify({ name: nested.name, version: '99.0.0' }), 'utf8');
      await writeFile(join(changedVersionPath, 'LICENSE'), 'Package-level MIT license.\n', 'utf8');
      await assert.rejects(buildThirdPartyNotices([
        { name: nested.name, version: '99.0.0', license: 'MIT', path: changedVersionPath }
      ], dependencyRoot), /nested license layout.*requires review/u);
      await rm(nestedLicensePath);
      await assert.rejects(buildThirdPartyNotices([
        { name: nested.name, version: nested.version, license: 'MIT', path: nestedPackagePath }
      ], dependencyRoot), /reviewed nested license file.*missing/u);
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('production notice aggregation rejects symbolic links named as license files', async context => {
  const temporaryRoot = await ensureWorkspaceTemporaryDirectory(workspaceRoot);
  const temporaryDirectory = await mkdtemp(join(temporaryRoot, 'mrt-notice-symlink-'));
  const dependencyRoot = join(temporaryDirectory, 'node_modules');
  const packagePath = join(dependencyRoot, 'symlink-package');
  try {
    await mkdir(packagePath, { recursive: true });
    await writeFile(join(packagePath, 'package.json'), JSON.stringify({ name: 'symlink-package', version: '1.0.0' }), 'utf8');
    await writeFile(join(packagePath, 'LICENSE-target.txt'), 'MIT License\n', 'utf8');
    try { await symlink(join(packagePath, 'LICENSE-target.txt'), join(packagePath, 'LICENSE'), 'file'); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') { context.skip('The current account cannot create a Windows file symlink.'); return; }
      throw error;
    }
    await assert.rejects(buildThirdPartyNotices([
      { name: 'symlink-package', version: '1.0.0', license: 'MIT', path: packagePath }
    ], dependencyRoot), /license file.*symbolic link/u);
  } finally { await rm(temporaryDirectory, { recursive: true, force: true }); }
});

test('production package integrity index binds scoped and unscoped lock entries to SHA-512 hashes', () => {
  const digest = Buffer.alloc(64, 0x5a).toString('base64');
  const toolDigest = Buffer.alloc(64, 0x33).toString('base64');
  const lockfile = `lockfileVersion: '9.0'\n\npackages:\n  'pnpm@12.15.0':\n    resolution: {integrity: sha512-${toolDigest}}\n\nsnapshots:\n  'pnpm@12.15.0': {}\n\nimporters:\n  .: {}\n\npackages:\n  '@scope/sample@1.2.3':\n    resolution: {integrity: sha512-${digest}}\n  plain-package@2.0.0:\n    resolution: {integrity: sha512-${digest}}\n\nsnapshots:\n  '@scope/sample@1.2.3': {}\n`;
  const index = productionPackageIntegrityIndex(lockfile);
  const expected = { alg: 'SHA-512', content: Buffer.alloc(64, 0x5a).toString('hex') };
  assert.deepEqual(index.get('@scope/sample@1.2.3'), expected);
  assert.deepEqual(index.get('plain-package@2.0.0'), expected);
  assert.equal(index.has('pnpm@12.15.0'), false);
  assert.throws(() => productionPackageIntegrityIndex(lockfile.replace('9.0', '8.0')), /unsupported/u);
  assert.throws(() => productionPackageIntegrityIndex(lockfile.replace(`sha512-${digest}`, 'sha512-invalid')), /invalid SHA-512/u);
  assert.throws(() => productionPackageIntegrityIndex(lockfile.replace(`sha512-${digest}`, `sha512-${'A'.repeat(89)}`)), /invalid SHA-512/u);
  assert.throws(() => productionPackageIntegrityIndex(lockfile.replace(`    resolution: {integrity: sha512-${digest}}`,
    `    resolution: {integrity: sha512-${digest}}\n    resolution: {integrity: sha512-${digest}}`)), /ambiguous integrity/u);
  assert.throws(() => productionPackageIntegrityIndex(lockfile.replace("  plain-package@2.0.0:",
    `  '@scope/sample@1.2.3':\n    resolution: {integrity: sha512-${digest}}\n  plain-package@2.0.0:`)), /repeats package key/u);
});

test('release inputs are read through bounded regular-file handles', async () => {
  const temporaryRoot = await ensureWorkspaceTemporaryDirectory(workspaceRoot);
  const temporaryDirectory = await mkdtemp(join(temporaryRoot, 'mrt-bounded-release-input-'));
  const filePath = join(temporaryDirectory, 'input');
  try {
    await writeFile(filePath, 'bounded');
    assert.deepEqual(await readBoundedRegularFile(filePath, 7), Buffer.from('bounded'));
    assert.equal(await readBoundedLockfile(filePath), 'bounded');
    await assert.rejects(readBoundedRegularFile(filePath, 6), /oversized/u);
    await writeFile(filePath, Buffer.from([0xff]));
    await assert.rejects(readBoundedLockfile(filePath), /lockfile is missing, oversized, or invalid/u);
    await truncate(filePath, 8 * 1024 * 1024 + 1);
    await assert.rejects(readBoundedLockfile(filePath), /lockfile is missing, oversized, or invalid/u);
    await writeFile(filePath, 'abc');
    assert.equal(await sha256RegularFile(filePath), 'BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD');
  } finally { await rm(temporaryDirectory, { recursive: true, force: true }); }
});

test('release inputs changed at the same size while being read are rejected', async () => {
  const temporaryRoot = await ensureWorkspaceTemporaryDirectory(workspaceRoot);
  const temporaryDirectory = await mkdtemp(join(temporaryRoot, 'mrt-changing-release-input-'));
  const filePath = join(temporaryDirectory, 'input');
  const input = Buffer.alloc(16 * 1024 * 1024, 0x61);
  try {
    await writeFile(filePath, input);
    const mutator = await open(filePath, 'r+');
    try {
      let stop = false;
      const mutation = (async () => {
        let value = 0x62;
        while (!stop) {
          await mutator.write(Buffer.from([value]), 0, 1, 0);
          value = value === 0x62 ? 0x63 : 0x62;
          await new Promise(resolveMutation => setImmediate(resolveMutation));
        }
      })();
      try {
        await assert.rejects(readBoundedRegularFile(filePath, input.length), /changed/u);
        await assert.rejects(sha256RegularFile(filePath), /changed/u);
      } finally {
        stop = true;
        await mutation;
      }
    } finally { await mutator.close(); }
  } finally { await rm(temporaryDirectory, { recursive: true, force: true }); }
});

test('bounded release input reader rejects a symbolic-link path', async context => {
  const temporaryRoot = await ensureWorkspaceTemporaryDirectory(workspaceRoot);
  const temporaryDirectory = await mkdtemp(join(temporaryRoot, 'mrt-release-input-symlink-'));
  const targetPath = join(temporaryDirectory, 'manifest.json');
  const linkPath = join(temporaryDirectory, 'linked-manifest.json');
  try {
    await writeFile(targetPath, '{"name":"fixture"}', 'utf8');
    try { await symlink(targetPath, linkPath, 'file'); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') {
        context.skip('The current account cannot create a Windows file symlink.');
        return;
      }
      throw error;
    }
    await assert.rejects(readBoundedRegularFile(linkPath, 1024), /not a regular file/u);
  } finally { await rm(temporaryDirectory, { recursive: true, force: true }); }
});

test('bounded release input reader rejects hard-linked files', async context => {
  const temporaryRoot = await ensureWorkspaceTemporaryDirectory(workspaceRoot);
  const temporaryDirectory = await mkdtemp(join(temporaryRoot, 'mrt-release-input-hardlink-'));
  const targetPath = join(temporaryDirectory, 'manifest.json');
  const hardLinkPath = join(temporaryDirectory, 'linked-manifest.json');
  try {
    await writeFile(targetPath, '{"name":"fixture"}', 'utf8');
    try { await link(targetPath, hardLinkPath); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') {
        context.skip('The current account cannot create a test hard link.');
        return;
      }
      throw error;
    }
    await assert.rejects(readBoundedRegularFile(hardLinkPath, 1024), /not a regular file/u);
  } finally { await rm(temporaryDirectory, { recursive: true, force: true }); }
});

test('distribution SBOM references include only credential-free public npm registry URLs', () => {
  const publicUrl = 'https://registry.npmjs.org/example-package/-/example-package-1.2.3.tgz';
  assert.equal(publicPackageDistributionUrl(publicUrl), publicUrl);
  for (const value of [
    'https://user:secret@registry.npmjs.org/example-package/-/example-package-1.2.3.tgz',
    'https://registry.npmjs.org/example-package/-/example-package-1.2.3.tgz?token=secret',
    'https://registry.npmjs.org/example-package/-/example-package-1.2.3.tgz#credential',
    'https://packages.internal.example/example-package-1.2.3.tgz',
    'https://registry.npmjs.org:8443/example-package/-/example-package-1.2.3.tgz',
    'http://registry.npmjs.org/example-package/-/example-package-1.2.3.tgz',
    `https://registry.npmjs.org/${'a'.repeat(2048)}`,
    'not a URL'
  ]) assert.equal(publicPackageDistributionUrl(value), undefined);
  assert.equal(publicPackageDistributionUrl(undefined), undefined);
});

test('Windows signed-release mode fails closed without a certificate reference', { skip: process.platform !== 'win32' || process.arch !== 'x64' }, () => {
  const environment: NodeJS.ProcessEnv = { ...process.env, MRT_SIGNED_RELEASE: '1' };
  delete environment.WIN_CSC_LINK;
  delete environment.WIN_CSC_KEY_PASSWORD;
  delete environment.CSC_LINK;
  delete environment.CSC_KEY_PASSWORD;
  const result = spawnSync(process.execPath, [resolve('scripts/package-win.mjs')], {
    cwd: resolve('.'),
    env: environment,
    encoding: 'utf8',
    windowsHide: true
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /A signed Windows release requires WIN_CSC_LINK or CSC_LINK/u);
});

test('Windows unsigned mode rejects inherited signing credentials', { skip: process.platform !== 'win32' || process.arch !== 'x64' }, () => {
  const environment: NodeJS.ProcessEnv = { ...process.env, MRT_SIGNED_RELEASE: '0', CSC_LINK: 'inherited-certificate.pfx' };
  delete environment.WIN_CSC_LINK;
  const result = spawnSync(process.execPath, [resolve('scripts/package-win.mjs')], {
    cwd: resolve('.'), env: environment, encoding: 'utf8', windowsHide: true
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsigned Windows packaging cannot use WIN_CSC_LINK or CSC_LINK/u);
});

test('Windows package failure removes the workspace-local pnpm shim', { skip: process.platform !== 'win32' || process.arch !== 'x64' }, async () => {
  const temporaryRoot = await ensureWorkspaceTemporaryDirectory(workspaceRoot);
  const temporaryDirectory = await mkdtemp(join(temporaryRoot, 'mrt-pnpm-failure-'));
  const alternatePnpmCli = join(temporaryDirectory, 'pnpm.cjs');
  const startedPath = join(temporaryDirectory, 'started');
  try {
    await writeFile(alternatePnpmCli, "const fs = require('node:fs'); const path = require('node:path'); const args = process.argv.slice(2); const calls = fs.existsSync(process.env.MRT_TEST_MARKER) ? JSON.parse(fs.readFileSync(process.env.MRT_TEST_MARKER, 'utf8')) : []; calls.push({ toolDirectory: process.env.PATH.split(path.delimiter)[0], args }); fs.writeFileSync(process.env.MRT_TEST_MARKER, JSON.stringify(calls)); if (args.includes('build')) process.exit(17);\n", 'utf8');
    const environment: NodeJS.ProcessEnv = { ...process.env, npm_execpath: alternatePnpmCli, MRT_SIGNED_RELEASE: '0', MRT_TEST_MARKER: startedPath };
    delete environment.WIN_CSC_LINK;
    delete environment.CSC_LINK;
    delete environment.WIN_CSC_KEY_PASSWORD;
    delete environment.CSC_KEY_PASSWORD;
    const result = spawnSync(process.execPath, [resolve('scripts/package-win.mjs')], {
      cwd: resolve('.'), env: environment, encoding: 'utf8', windowsHide: true
    });
    assert.ok(result.status !== null && result.status !== 0, result.stderr);
    const invocations = JSON.parse(await readFile(startedPath, 'utf8')) as readonly {
      readonly toolDirectory: string; readonly args: readonly string[]
    }[];
    const temporaryToolDirectory = invocations[0]?.toolDirectory;
    assert.ok(temporaryToolDirectory);
    assert.deepEqual(invocations.map(invocation => invocation.args), [
      ['--filter', '@mrt/desktop', 'audit', 'signatures', '--prod'],
      ['--workspace-root', 'audit', 'signatures', '--dev'],
      ['build']
    ]);
    await assert.rejects(access(join(temporaryToolDirectory, 'pnpm.cmd')), error => (error as NodeJS.ErrnoException).code === 'ENOENT');
    await assert.rejects(access(temporaryToolDirectory), error => (error as NodeJS.ErrnoException).code === 'ENOENT');
  } finally { await rm(temporaryDirectory, { recursive: true, force: true }); }
});

test('Windows distribution SBOM refuses a pnpm CLI that differs from the repository pin', { skip: process.platform !== 'win32' || process.arch !== 'x64' }, async () => {
  const temporaryRoot = await ensureWorkspaceTemporaryDirectory(workspaceRoot);
  const temporaryDirectory = await mkdtemp(join(temporaryRoot, 'mrt-pnpm-pin-'));
  try {
    const alternatePnpmCli = join(temporaryDirectory, 'pnpm.cjs');
    await writeFile(alternatePnpmCli, "process.stdout.write('99.0.0\\n');\n", 'utf8');
    const environment: NodeJS.ProcessEnv = { ...process.env, npm_execpath: alternatePnpmCli, MRT_SIGNED_RELEASE: '0' };
    delete environment.MRT_RELEASE_SIGNER_SHA1;
    const result = spawnSync(process.execPath, [resolve('scripts/generate-distribution-sbom.mjs')], {
      cwd: resolve('.'),
      env: environment,
      encoding: 'utf8',
      windowsHide: true
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Use pinned pnpm 12\.15\.0.*found 99\.0\.0/u);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
