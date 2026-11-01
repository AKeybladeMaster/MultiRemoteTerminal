import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, opendir, realpath, rename, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const maxPackages = 512;
const maxFileBytes = 1024 * 1024;
const maxNoticeBytes = 8 * 1024 * 1024;
const maxMetadataChars = 512;
const maxPathChars = 32_767;
const maxLockfileBytes = 8 * 1024 * 1024;
const maxPackageDirectoryEntries = 4096;
const licenseFileName = /^(?:licenses?|licences?|unlicense|copying|notice|third[._ -]?party[._ -]notices?)(?:[._ -].*)?$/iu;
const unsafeMetadataCharacters = /[\p{Cc}\p{Cf}]/u;

function sameFileSnapshot(before, after) {
  return after.isFile() && before.dev === after.dev && before.ino === after.ino && before.nlink === after.nlink &&
    before.size === after.size && before.mode === after.mode && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
}

export async function ensureWorkspaceOutputDirectory(projectRoot, components) {
  if (!Array.isArray(components) || components.some(component =>
    typeof component !== 'string' || !/^[A-Za-z0-9._-]+$/u.test(component) || component === '.' || component === '..')) {
    throw new TypeError('Workspace output directory components must be bounded simple names.');
  }
  const realProjectRoot = await realpath(projectRoot);
  let currentDirectory = realProjectRoot;
  for (const component of components) {
    const nextDirectory = join(currentDirectory, component);
    let details;
    try { details = await lstat(nextDirectory); }
    catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
      try { await mkdir(nextDirectory); }
      catch (createError) {
        if (!(createError && typeof createError === 'object' && 'code' in createError && createError.code === 'EEXIST')) throw createError;
      }
      details = await lstat(nextDirectory);
    }
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error('Workspace output directories must be real directories inside the workspace.');
    }
    const realDirectory = await realpath(nextDirectory);
    const relativePath = relative(realProjectRoot, realDirectory);
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      throw new Error('Workspace output directories must be real directories inside the workspace.');
    }
    currentDirectory = realDirectory;
  }
  return currentDirectory;
}

export async function ensureWorkspaceTemporaryDirectory(projectRoot) {
  return ensureWorkspaceOutputDirectory(projectRoot, ['.tmp']);
}
export async function writeWorkspaceOutputFile(projectRoot, components, fileName, contents) {
  if (typeof fileName !== 'string' || fileName.length === 0 || fileName.length > 512 || fileName === '.' || fileName === '..' ||
      /[<>:"/\\|?*]/u.test(fileName) || unsafeMetadataCharacters.test(fileName)) {
    throw new TypeError('The generated workspace output name is invalid.');
  }
  if (typeof contents !== 'string' || contents.length === 0 || Buffer.byteLength(contents, 'utf8') > maxNoticeBytes) {
    throw new TypeError('The generated workspace output is empty or exceeds its size bound.');
  }
  const outputDirectory = await ensureWorkspaceOutputDirectory(projectRoot, components);
  const outputPath = join(outputDirectory, fileName);
  let details;
  try {
    details = await lstat(outputPath);
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  if (details && (!details.isFile() || details.isSymbolicLink() || details.nlink !== 1)) {
    throw new Error('Generated workspace output must be a regular, unlinked workspace file.');
  }

  const temporaryPath = join(outputDirectory, `.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    const staged = await handle.stat({ bigint: true });
    if (!staged.isFile() || staged.nlink !== 1n || staged.size !== BigInt(Buffer.byteLength(contents, 'utf8'))) {
      throw new Error('Generated workspace output changed while it was written.');
    }
    await handle.close();
    handle = undefined;
    let current;
    try { current = await lstat(outputPath); }
    catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    if (details ? !current || !current.isFile() || current.isSymbolicLink() || current.nlink !== 1 ||
        current.dev !== details.dev || current.ino !== details.ino || current.size !== details.size ||
        current.mtimeMs !== details.mtimeMs || current.ctimeMs !== details.ctimeMs : current !== undefined) {
      throw new Error('Generated workspace output changed before it could be replaced.');
    }
    await rename(temporaryPath, outputPath);
    return outputPath;
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeWorkspaceTemporaryNoticeFile(projectRoot, contents) {
  return writeWorkspaceOutputFile(projectRoot, ['.tmp'], 'THIRD-PARTY-NOTICES.txt', contents);
}
// Keep package versions pinned until each nested license layout is reviewed.
const reviewedNestedLicenseFiles = new Map([
  ['cpu-features', { version: '0.0.10', files: ['deps/cpu_features/LICENSE'] }],
  ['node-pty', { version: '1.1.0', files: ['deps/winpty/LICENSE'] }]
]);

function isBoundedMetadata(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxMetadataChars && !unsafeMetadataCharacters.test(value);
}

function isBoundedPath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxPathChars && !unsafeMetadataCharacters.test(value);
}

export async function readInstalledPackageManifest(candidatePath, dependencyRoot) {
  const root = await realpath(dependencyRoot);
  const packagePath = await realpath(candidatePath);
  const pathFromRoot = relative(root, packagePath);
  if (!pathFromRoot || pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new Error('The installed package path is outside node_modules.');
  }

  try {
    const manifestPath = resolve(packagePath, 'package.json');
    const manifestDetails = await lstat(manifestPath);
    const resolvedManifestPath = await realpath(manifestPath);
    const manifestRelativePath = relative(packagePath, resolvedManifestPath);
    if (!manifestDetails.isFile() || manifestDetails.isSymbolicLink() || manifestDetails.size > maxFileBytes ||
      !manifestRelativePath || manifestRelativePath === '..' || manifestRelativePath.startsWith(`..${sep}`) || isAbsolute(manifestRelativePath)) {
      throw new Error('Invalid package manifest file.');
    }
    const manifestText = new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedPackageFile(resolvedManifestPath, packagePath));
    return { packagePath, manifest: JSON.parse(manifestText) };
  } catch {
    throw new Error('The installed package metadata is missing or invalid.');
  }
}

export function publicPackageDistributionUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.username || url.password ||
      url.port || url.search || url.hash) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

async function readBoundedPackageFile(candidatePath, packagePath) {
  const filePath = await realpath(candidatePath);
  const pathFromPackage = relative(packagePath, filePath);
  if (!pathFromPackage || pathFromPackage === '..' || pathFromPackage.startsWith(`..${sep}`) || isAbsolute(pathFromPackage)) {
    throw new Error('The package file is outside its package directory.');
  }
  try { return await readBoundedRegularFile(filePath, maxFileBytes); }
  catch { throw new Error('The package file is empty, oversized, or not a regular file.'); }
}

export async function readBoundedRegularFile(candidatePath, maxBytes) {
  if (typeof candidatePath !== 'string' || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError('A bounded regular file path and positive byte limit are required.');
  }
  const details = await lstat(candidatePath, { bigint: true });
  if (!details.isFile() || details.isSymbolicLink() || details.nlink !== 1n || details.size === 0n || details.size > BigInt(maxBytes)) {
    throw new Error('The regular file is empty, oversized, or not a regular file.');
  }

  const handle = await open(candidatePath, 'r');
  try {
    const openedFile = await handle.stat({ bigint: true });
    if (!openedFile.isFile() || openedFile.nlink !== 1n || openedFile.size === 0n || openedFile.size > BigInt(maxBytes) ||
      openedFile.dev !== details.dev || openedFile.ino !== details.ino) {
      throw new Error('The regular file changed or is not a bounded regular file.');
    }
    const expectedSize = Number(openedFile.size);
    const chunks = [];
    const chunk = Buffer.alloc(64 * 1024);
    let totalBytes = 0;
    while (totalBytes <= maxBytes) {
      const length = Math.min(chunk.length, maxBytes + 1 - totalBytes);
      const { bytesRead } = await handle.read(chunk, 0, length, null);
      if (bytesRead === 0) break;
      chunks.push(Buffer.from(chunk.subarray(0, bytesRead)));
      totalBytes += bytesRead;
    }
    if (totalBytes === 0 || totalBytes > maxBytes || totalBytes !== expectedSize ||
      !sameFileSnapshot(openedFile, await handle.stat({ bigint: true }))) {
      throw new Error('The regular file is empty, changed during reading, or exceeds its size bound.');
    }
    return Buffer.concat(chunks, totalBytes);
  } finally {
    await handle.close();
  }
}

export async function sha256RegularFile(candidatePath) {
  const details = await lstat(candidatePath, { bigint: true });
  if (!details.isFile() || details.isSymbolicLink() || details.size === 0n || details.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('The file is empty or not a regular file.');
  }
  const handle = await open(candidatePath, 'r');
  try {
    const openedFile = await handle.stat({ bigint: true });
    if (!openedFile.isFile() || openedFile.nlink !== 1n || openedFile.size !== details.size ||
      openedFile.dev !== details.dev || openedFile.ino !== details.ino) {
      throw new Error('The file changed or is not a regular file.');
    }
    const expectedSize = Number(openedFile.size);
    const hash = createHash('sha256');
    const chunk = Buffer.alloc(64 * 1024);
    let totalBytes = 0;
    while (totalBytes < expectedSize) {
      const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, expectedSize - totalBytes), totalBytes);
      if (bytesRead === 0) throw new Error('The file changed while it was being hashed.');
      hash.update(chunk.subarray(0, bytesRead));
      totalBytes += bytesRead;
    }
    const { bytesRead } = await handle.read(chunk, 0, 1, totalBytes);
    if (bytesRead !== 0 || !sameFileSnapshot(openedFile, await handle.stat({ bigint: true }))) {
      throw new Error('The file changed while it was being hashed.');
    }
    return hash.digest('hex').toUpperCase();
  } finally {
    await handle.close();
  }
}

export async function readBoundedLockfile(candidatePath) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedRegularFile(candidatePath, maxLockfileBytes));
  } catch {
    throw new Error('The pnpm lockfile is missing, oversized, or invalid.');
  }
}

export function productionLicensePackages(licensesByType) {
  if (!licensesByType || typeof licensesByType !== 'object' || Array.isArray(licensesByType)) {
    throw new Error('pnpm returned an invalid production license inventory.');
  }
  const packages = [];
  const declaredLicenses = new Map();
  for (const entries of Object.values(licensesByType)) {
    if (!Array.isArray(entries)) throw new Error('pnpm returned an invalid production license group.');
    for (const entry of entries) {
      if (!isBoundedMetadata(entry?.name) || !isBoundedMetadata(entry.license) ||
        !Array.isArray(entry.versions) || !Array.isArray(entry.paths) || entry.versions.length !== entry.paths.length) {
        throw new Error('pnpm returned an incomplete production package license record.');
      }
      for (const [index, version] of entry.versions.entries()) {
        const path = entry.paths[index];
        if (!isBoundedMetadata(version) || !isBoundedPath(path)) {
          throw new Error(`pnpm returned an invalid license path for ${entry.name}.`);
        }
        const identity = JSON.stringify([entry.name, version]);
        const existingLicense = declaredLicenses.get(identity);
        if (existingLicense && existingLicense !== entry.license) {
          throw new Error(`pnpm returned conflicting production licenses for ${entry.name}@${version}.`);
        }
        declaredLicenses.set(identity, entry.license);
        if (packages.length >= maxPackages) throw new Error('The production package license inventory exceeds its bound.');
        packages.push({ name: entry.name, version, license: entry.license, path });
      }
    }
  }
  if (packages.length === 0 || packages.length > maxPackages) {
    throw new Error('The production package license inventory is empty or exceeds its bound.');
  }
  return packages.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 :
    left.version < right.version ? -1 : left.version > right.version ? 1 : 0);
}

export function productionPackageIntegrityIndex(lockfileText) {
  if (typeof lockfileText !== 'string' || Buffer.byteLength(lockfileText, 'utf8') > maxLockfileBytes ||
    !/^lockfileVersion:[ \t]*['"]?9\.0['"]?[ \t]*$/mu.test(lockfileText)) {
    throw new Error('The production package lockfile is missing, oversized, or unsupported.');
  }
  const lines = lockfileText.split(/\r?\n/u);
  const packagesStart = lines.indexOf('packages:');
  const snapshotsStart = lines.indexOf('snapshots:', packagesStart + 1);
  if (packagesStart < 0 || snapshotsStart <= packagesStart) throw new Error('The pnpm package lockfile sections are invalid.');

  const index = new Map();
  const packageKeys = new Set();
  let packageKey;
  let packageIntegrity;
  const addPackage = () => {
    if (!packageKey || !packageIntegrity) return;
    if (packageIntegrity.length !== 88) throw new Error(`The pnpm lockfile has invalid SHA-512 integrity for ${packageKey}.`);
    const digest = Buffer.from(packageIntegrity, 'base64');
    if (digest.length !== 64 || digest.toString('base64') !== packageIntegrity) {
      throw new Error(`The pnpm lockfile has invalid SHA-512 integrity for ${packageKey}.`);
    }
    const identity = packageKey.replace(/\(.*$/u, '');
    const existing = index.get(identity);
    const hash = { alg: 'SHA-512', content: digest.toString('hex') };
    if (existing && (existing.alg !== hash.alg || existing.content !== hash.content)) {
      throw new Error(`The pnpm lockfile has conflicting integrity records for ${identity}.`);
    }
    index.set(identity, hash);
  };

  for (const line of lines.slice(packagesStart + 1, snapshotsStart)) {
    const header = line.match(/^  (?:'([^']+)'|"([^"]+)"|([^:\s][^:]*)):\s*$/u);
    if (header) {
      addPackage();
      packageKey = header[1] ?? header[2] ?? header[3];
      if (packageKeys.has(packageKey)) throw new Error(`The pnpm lockfile repeats package key ${packageKey}.`);
      packageKeys.add(packageKey);
      packageIntegrity = undefined;
      continue;
    }
    if (!packageKey || !line.startsWith('    resolution:')) continue;
    const values = [...line.matchAll(/\bintegrity:\s*sha512-([A-Za-z0-9+/]+={0,2})/gu)];
    if (values.length > 1 || packageIntegrity && values.length === 1) throw new Error(`The pnpm lockfile has ambiguous integrity for ${packageKey}.`);
    packageIntegrity = values[0]?.[1];
  }
  addPackage();
  if (index.size === 0) throw new Error('The pnpm lockfile contains no SHA-512 package integrity records.');
  return index;
}

export async function buildThirdPartyNotices(packages, dependencyRoot) {
  if (!Array.isArray(packages) || packages.length === 0 || packages.length > maxPackages) {
    throw new Error('The third-party notice package list is empty or exceeds its bound.');
  }
  const sections = ['MultiRemoteTerminal production dependency notices'];
  let totalBytes = Buffer.byteLength(sections[0], 'utf8');

  for (const dependency of packages) {
    if (!isBoundedMetadata(dependency.name) || !isBoundedMetadata(dependency.version) ||
      !isBoundedMetadata(dependency.license) || !isBoundedPath(dependency.path)) {
      throw new Error('A production package has invalid notice metadata.');
    }
    const { packagePath, manifest } = await readInstalledPackageManifest(dependency.path, dependencyRoot)
      .catch(error => {
        if (error instanceof Error && error.message.includes('outside node_modules')) {
          throw new Error(`The license inventory path for ${dependency.name}@${dependency.version} is outside node_modules.`);
        }
        throw new Error(`The installed package metadata for ${dependency.name}@${dependency.version} is missing or invalid.`);
      });
    if (manifest?.name !== dependency.name || manifest?.version !== dependency.version) {
      throw new Error(`The installed package metadata does not match ${dependency.name}@${dependency.version}.`);
    }
    const reviewedNested = reviewedNestedLicenseFiles.get(dependency.name);
    if (reviewedNested && reviewedNested.version !== dependency.version) {
      throw new Error(`The nested license layout for ${dependency.name}@${dependency.version} requires review.`);
    }
    const files = [];
    let entryCount = 0;
    for await (const entry of await opendir(packagePath)) {
      entryCount += 1;
      if (entryCount > maxPackageDirectoryEntries) throw new Error(`The package directory for ${dependency.name}@${dependency.version} exceeds its entry limit.`);
      const isLicenseFile = licenseFileName.test(entry.name);
      if (!isLicenseFile) {
        if (unsafeMetadataCharacters.test(entry.name) && licenseFileName.test(entry.name.replace(/[\p{Cc}\p{Cf}]/gu, ''))) {
          throw new Error(`A license filename for ${dependency.name}@${dependency.version} contains control or format characters.`);
        }
        continue;
      }
      if (unsafeMetadataCharacters.test(entry.name)) {
        throw new Error(`A license filename for ${dependency.name}@${dependency.version} contains control or format characters.`);
      }
      if (entry.isSymbolicLink()) throw new Error(`A license file for ${dependency.name}@${dependency.version} is a symbolic link.`);
      if (entry.isFile()) files.push({ fileName: entry.name, path: resolve(packagePath, entry.name) });
    }
    for (const nestedFile of reviewedNested?.files ?? []) {
      const nestedPath = resolve(packagePath, ...nestedFile.split('/'));
      let details;
      try { details = await lstat(nestedPath); }
      catch { throw new Error(`A reviewed nested license file for ${dependency.name}@${dependency.version} is missing.`); }
      if (!details.isFile() || details.isSymbolicLink()) {
        throw new Error(`A reviewed nested license file for ${dependency.name}@${dependency.version} is not a regular file.`);
      }
      const resolvedPath = await realpath(nestedPath);
      const nestedRelativePath = relative(packagePath, resolvedPath);
      if (!nestedRelativePath || nestedRelativePath === '..' || nestedRelativePath.startsWith(`..${sep}`) || isAbsolute(nestedRelativePath)) {
        throw new Error(`A reviewed nested license file for ${dependency.name}@${dependency.version} is outside its package.`);
      }
      files.push({ fileName: nestedRelativePath.split(sep).join('/'), path: resolvedPath });
    }
    files.sort((left, right) => left.fileName < right.fileName ? -1 : left.fileName > right.fileName ? 1 : 0);
    if (files.length === 0) throw new Error(`No license or notice file was found for ${dependency.name}@${dependency.version}.`);
    if (files.some(file => unsafeMetadataCharacters.test(file.fileName))) {
      throw new Error(`A license filename for ${dependency.name}@${dependency.version} contains control or format characters.`);
    }

    sections.push(`\nPackage: ${dependency.name}@${dependency.version}\nDeclared license: ${dependency.license}`);
    for (const file of files) {
      let contents;
      try { contents = await readBoundedPackageFile(file.path, packagePath); }
      catch (error) {
        if (error instanceof Error && error.message.startsWith('The package file')) {
          throw new Error(`The ${file.fileName} file for ${dependency.name}@${dependency.version} is invalid: ${error.message}`);
        }
        throw error;
      }
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(contents); }
      catch { throw new Error(`The ${file.fileName} file for ${dependency.name}@${dependency.version} is not UTF-8 text.`); }
      if (text.includes('\0')) throw new Error(`The ${file.fileName} file for ${dependency.name}@${dependency.version} contains binary data.`);
      sections.push(`\n--- ${file.fileName} ---\n${text}${text.endsWith('\n') ? '' : '\n'}`);
      totalBytes += contents.length;
      if (totalBytes > maxNoticeBytes) throw new Error('The production third-party notices exceed their total size bound.');
    }
  }
  const notices = `${sections.join('\n')}\n`;
  if (Buffer.byteLength(notices, 'utf8') > maxNoticeBytes) {
    throw new Error('The production third-party notices exceed their total size bound.');
  }
  return notices;
}
