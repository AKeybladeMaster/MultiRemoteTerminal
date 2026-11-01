import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseSigners, assertUnsignedReleaseArtifacts, expectedReleaseSigner, signedReleaseRequested } from './release-signature-policy.mjs';
import { ensureWorkspaceOutputDirectory, productionLicensePackages, productionPackageIntegrityIndex, publicPackageDistributionUrl,
  readBoundedLockfile, readBoundedRegularFile, readInstalledPackageManifest, sha256RegularFile, writeWorkspaceOutputFile } from './third-party-notices.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const productName = 'MultiRemoteTerminal';
const requireSignedRelease = signedReleaseRequested(process.env.MRT_SIGNED_RELEASE);
const expectedSignerThumbprint = requireSignedRelease ? expectedReleaseSigner(process.env.MRT_RELEASE_SIGNER_SHA1) : undefined;

function runPnpm(args) {
  const cli = process.env.npm_execpath;
  if (!cli) throw new Error('Run this script through the pinned pnpm command.');
  const isJavaScriptCli = /\.[cm]?js$/iu.test(cli);
  const result = spawnSync(isJavaScriptCli ? process.execPath : cli,
    [...(isJavaScriptCli ? [cli] : []), ...args], {
      cwd: projectRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true
    });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Pinned pnpm command failed: ${args[0]}`);
  return result.stdout;
}

function runPnpmJson(args) {
  return JSON.parse(runPnpm(args));
}

function packageUrl(name, version) {
  const npmName = name.startsWith('@') ? name.replace(/^@/u, '%40') : name;
  return `pkg:npm/${npmName}@${version}`;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

async function readJson(path) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedRegularFile(path, 1024 * 1024)));
}

function readSignatures(artifactsRoot, artifactNames) {
  const result = spawnSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-File',
    resolve(projectRoot, 'scripts/inspect-authenticode.ps1'),
    '-ArtifactDirectory', artifactsRoot,
    '-ArtifactNamesBase64', Buffer.from(artifactNames.join('\n'), 'utf8').toString('base64')
  ], { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Could not inspect Windows Authenticode signatures.');
  return JSON.parse(result.stdout);
}

function buildBom({ artifactName, artifactHash, appArchiveHash, signature, dependencies, components,
  desktopPackage, toolchain, notices }) {
  const productRef = `pkg:generic/multiremote-terminal@${desktopPackage.version}?arch=x64&platform=windows`;
  const artifactKind = artifactName.includes(' Setup ') ? 'nsis-installer' : 'portable-executable';
  const properties = [
    { name: 'mrt:distribution:artifact', value: artifactName },
    { name: 'mrt:distribution:kind', value: artifactKind },
    { name: 'mrt:distribution:platform', value: 'windows' },
    { name: 'mrt:distribution:architecture', value: 'x64' },
    { name: 'mrt:authenticode:status', value: signature.status },
    { name: 'mrt:payload:app-asar-sha256', value: appArchiveHash },
    { name: 'mrt:build:node', value: toolchain.node },
    { name: 'mrt:build:pnpm', value: toolchain.pnpm },
    { name: 'mrt:build:electron-builder', value: toolchain.electronBuilder },
    ...notices.map(notice => ({ name: `mrt:distribution:notice:${notice.id}:sha256`, value: notice.hash }))
  ];
  if (signature.signerThumbprint) properties.push({ name: 'mrt:authenticode:signer-thumbprint', value: signature.signerThumbprint });
  if (signature.signerSubject) properties.push({ name: 'mrt:authenticode:signer-subject', value: signature.signerSubject });

  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
    metadata: {
      lifecycles: [{ phase: 'post-build' }],
      component: {
        type: 'application',
        'bom-ref': productRef,
        name: productName,
        version: desktopPackage.version,
        purl: productRef,
        hashes: [{ alg: 'SHA-256', content: artifactHash }],
        properties
      }
    },
    components: components.sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref'])),
    dependencies: [
      ...[...dependencies.entries()].map(([ref, packageDependencies]) => ({
        ref,
        dependsOn: [...packageDependencies].sort()
      })).sort((left, right) => left.ref.localeCompare(right.ref))
    ]
  };
}

function readLicenseIndex(licensesByType) {
  const index = new Map();
  for (const { name, version, license } of productionLicensePackages(licensesByType)) {
    index.set(packageUrl(name, version), license);
  }
  return index;
}

async function collectProductionGraph(rootDependencies, licenseIndex, integrityIndex, productRef) {
  const componentsByRef = new Map();
  const graph = new Map();

  async function visit(parentRef, dependencyName, dependency) {
    if (!dependency || typeof dependency.version !== 'string' || typeof dependency.path !== 'string') {
      throw new Error(`Pinned pnpm did not resolve a runtime dependency: ${dependencyName}`);
    }
    const name = dependency.name ?? dependencyName;
    const ref = packageUrl(name, dependency.version);
    const declaredLicense = licenseIndex.get(ref);
    if (!declaredLicense) throw new Error(`No declared license was found for runtime dependency ${name}@${dependency.version}.`);
    const lockedIntegrity = integrityIndex.get(`${name}@${dependency.version}`);
    if (!lockedIntegrity) throw new Error(`No SHA-512 integrity was found in pnpm-lock.yaml for ${name}@${dependency.version}.`);
    const packageDependencies = graph.get(ref) ?? new Set();
    graph.set(ref, packageDependencies);
    graph.get(parentRef)?.add(ref);

    if (!componentsByRef.has(ref)) {
      const { manifest } = await readInstalledPackageManifest(dependency.path, join(projectRoot, 'node_modules'));
      if (manifest.name !== name || manifest.version !== dependency.version) {
        throw new Error(`Installed metadata did not match the pinned dependency ${name}@${dependency.version}.`);
      }
      const distributionUrl = publicPackageDistributionUrl(dependency.resolved);
      const component = {
        type: 'library',
        scope: 'required',
        'bom-ref': ref,
        name,
        version: dependency.version,
        purl: ref,
        licenses: [{ expression: declaredLicense }],
        hashes: [lockedIntegrity],
        ...(distributionUrl
          ? { externalReferences: [{ type: 'distribution', url: distributionUrl }] }
          : {})
      };
      componentsByRef.set(ref, component);
    }

    for (const [childName, child] of Object.entries(dependency.dependencies ?? {})) await visit(ref, childName, child);
  }

  graph.set(productRef, new Set());
  for (const [name, dependency] of Object.entries(rootDependencies)) await visit(productRef, name, dependency);
  return { graph, components: [...componentsByRef.values()] };
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Generate the Windows distribution SBOM on the Windows x64 packaging host.');
  }
  const artifactsRoot = await ensureWorkspaceOutputDirectory(projectRoot, ['artifacts', 'windows']);
  const rootPackage = await readJson(join(projectRoot, 'package.json'));
  const desktopPackage = await readJson(join(projectRoot, 'apps/desktop/package.json'));
  if (process.versions.node !== rootPackage.engines.node) {
    throw new Error(`Use pinned Node ${rootPackage.engines.node} to create the Windows distribution SBOM.`);
  }
  const expectedPnpm = rootPackage.packageManager?.match(/^pnpm@(.+)$/u)?.[1];
  if (!expectedPnpm) throw new Error('The repository must declare its pinned pnpm version in packageManager.');
  const actualPnpm = runPnpm(['--version']).trim();
  if (actualPnpm !== expectedPnpm) {
    throw new Error(`Use pinned pnpm ${expectedPnpm} to create the Windows distribution SBOM; found ${actualPnpm}.`);
  }

  const pnpmGraph = runPnpmJson(['ls', '--filter', '@mrt/desktop', '--prod', '--depth', 'Infinity', '--json']);
  const licenseIndex = readLicenseIndex(runPnpmJson(['licenses', 'list', '--prod', '--filter', '@mrt/desktop', '--json']));
  const integrityIndex = productionPackageIntegrityIndex(await readBoundedLockfile(join(projectRoot, 'pnpm-lock.yaml')));
  const root = pnpmGraph.find(project => project.name === '@mrt/desktop');
  if (!root || root.version !== desktopPackage.version) throw new Error('Could not match the production graph to the desktop package.');
  const electronVersion = rootPackage.devDependencies?.electron;
  const { manifest: electronManifest } = await readInstalledPackageManifest(resolve(projectRoot, 'node_modules/electron'), join(projectRoot, 'node_modules'));
  if (!electronVersion || electronManifest.version !== electronVersion) throw new Error('The packaged Electron runtime did not match the pinned version.');
  const electronRef = packageUrl('electron', electronVersion);
  licenseIndex.set(electronRef, electronManifest.license);

  const artifactNames = [
    `${productName} Setup ${desktopPackage.version}.exe`,
    `${productName} ${desktopPackage.version}.exe`
  ];
  const signatures = readSignatures(artifactsRoot, artifactNames);
  if (!Array.isArray(signatures) || signatures.length !== artifactNames.length) {
    throw new Error('Windows Authenticode inspection returned an incomplete result.');
  }
  if (expectedSignerThumbprint) assertReleaseSigners(signatures, artifactNames, expectedSignerThumbprint);
  else assertUnsignedReleaseArtifacts(signatures, artifactNames);
  const notices = [];
  for (const [id, fileName] of [
    ['electron-license', 'LICENSE.electron.txt'],
    ['chromium-licenses', 'LICENSES.chromium.html'],
    ['production-dependency-notices', 'resources/THIRD-PARTY-NOTICES.txt']
  ]) {
    const filePath = join(artifactsRoot, 'win-unpacked', fileName);
    let hash;
    try { hash = await sha256RegularFile(filePath); }
    catch { throw new Error(`The packaged Windows app is missing or has an invalid ${fileName} third-party notice.`); }
    notices.push({ id, fileName: `win-unpacked/${fileName}`, hash });
  }

  const electronDependencies = {};
  // Electron ships as the application runtime and is pinned in the root toolchain manifest.
  const electronPath = resolve(projectRoot, 'node_modules/electron');
  electronDependencies.electron = {
    name: 'electron', version: electronVersion, path: electronPath,
    resolved: `https://registry.npmjs.org/electron/-/electron-${electronVersion}.tgz`, dependencies: {}
  };
  const dependencyTree = { ...root.dependencies, ...electronDependencies };
  const productRef = `pkg:generic/multiremote-terminal@${desktopPackage.version}?arch=x64&platform=windows`;
  const { graph, components } = await collectProductionGraph(dependencyTree, licenseIndex, integrityIndex, productRef);
  const appArchivePath = join(artifactsRoot, 'win-unpacked/resources/app.asar');
  const appArchiveHash = await sha256RegularFile(appArchivePath);
  const toolchain = {
    node: rootPackage.engines.node,
    pnpm: actualPnpm,
    electronBuilder: rootPackage.devDependencies['electron-builder']
  };

  const checksumEntries = notices.map(notice => `${notice.hash}  ${notice.fileName}`);
  for (const [index, artifactName] of artifactNames.entries()) {
    const artifactPath = join(artifactsRoot, artifactName);
    const artifactHash = await sha256RegularFile(artifactPath);
    const bom = buildBom({ artifactName, artifactHash, appArchiveHash, signature: signatures[index],
      dependencies: graph, components: [...components], desktopPackage, toolchain, notices });
    const bomName = `${artifactName}.cdx.json`;
    const bomContents = `${JSON.stringify(bom, null, 2)}\n`;
    await writeWorkspaceOutputFile(projectRoot, ['artifacts', 'windows'], bomName, bomContents);
    checksumEntries.push(`${artifactHash}  ${artifactName}`, `${sha256(bomContents)}  ${bomName}`);
  }
  await writeWorkspaceOutputFile(projectRoot, ['artifacts', 'windows'], 'SHA256SUMS.txt', `${checksumEntries.sort().join('\n')}\n`);
  console.log(`Generated per-artifact CycloneDX 1.6 SBOMs for ${components.length} resolved runtime components; signatures: ${signatures.map(item => item.status).join(', ')}.`);
}

await main();
