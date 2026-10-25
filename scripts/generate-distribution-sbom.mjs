import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactsRoot = resolve(projectRoot, 'artifacts/windows');
const productName = 'MultiRemoteTerminal';
const requireSignedRelease = process.env.MRT_SIGNED_RELEASE === '1';

function runPnpmJson(args) {
  const cli = process.env.npm_execpath;
  if (!cli) throw new Error('Run this script through the pinned pnpm command.');
  const isJavaScriptCli = /\.[cm]?js$/iu.test(cli);
  const result = spawnSync(isJavaScriptCli ? process.execPath : cli,
    [...(isJavaScriptCli ? [cli] : []), ...args], {
      cwd: projectRoot,
      encoding: 'utf8',
      windowsHide: true
    });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Pinned pnpm command failed: ${args[0]}`);
  return JSON.parse(result.stdout);
}

function packageUrl(name, version) {
  const npmName = name.startsWith('@') ? name.replace(/^@/u, '%40') : name;
  return `pkg:npm/${npmName}@${version}`;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function readSignatures(artifactNames) {
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
  desktopPackage, toolchain }) {
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
    { name: 'mrt:build:electron-builder', value: toolchain.electronBuilder }
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
  for (const entries of Object.values(licensesByType)) {
    for (const entry of entries) {
      for (const version of entry.versions) index.set(packageUrl(entry.name, version), entry.license);
    }
  }
  return index;
}

async function collectProductionGraph(rootDependencies, licenseIndex, productRef) {
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
    const packageDependencies = graph.get(ref) ?? new Set();
    graph.set(ref, packageDependencies);
    graph.get(parentRef)?.add(ref);

    if (!componentsByRef.has(ref)) {
      const manifest = await readJson(join(dependency.path, 'package.json'));
      if (manifest.name !== name || manifest.version !== dependency.version) {
        throw new Error(`Installed metadata did not match the pinned dependency ${name}@${dependency.version}.`);
      }
      const component = {
        type: 'library',
        scope: 'required',
        'bom-ref': ref,
        name,
        version: dependency.version,
        purl: ref,
        licenses: [{ expression: declaredLicense }],
        ...(typeof manifest.description === 'string' && manifest.description.length > 0
          ? { description: manifest.description }
          : {}),
        ...(typeof dependency.resolved === 'string' && dependency.resolved.startsWith('https://')
          ? { externalReferences: [{ type: 'distribution', url: dependency.resolved }] }
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
  const rootPackage = await readJson(join(projectRoot, 'package.json'));
  const desktopPackage = await readJson(join(projectRoot, 'apps/desktop/package.json'));
  if (process.versions.node !== rootPackage.engines.node) {
    throw new Error(`Use pinned Node ${rootPackage.engines.node} to create the Windows distribution SBOM.`);
  }

  const pnpmGraph = runPnpmJson(['ls', '--filter', '@mrt/desktop', '--prod', '--depth', 'Infinity', '--json']);
  const licenseIndex = readLicenseIndex(runPnpmJson(['licenses', 'list', '--prod', '--filter', '@mrt/desktop', '--json']));
  const root = pnpmGraph.find(project => project.name === '@mrt/desktop');
  if (!root || root.version !== desktopPackage.version) throw new Error('Could not match the production graph to the desktop package.');
  const electronVersion = rootPackage.devDependencies?.electron;
  const electronManifest = await readJson(resolve(projectRoot, 'node_modules/electron/package.json'));
  if (!electronVersion || electronManifest.version !== electronVersion) throw new Error('The packaged Electron runtime did not match the pinned version.');
  const electronRef = packageUrl('electron', electronVersion);
  licenseIndex.set(electronRef, electronManifest.license);

  const artifactNames = [
    `${productName} Setup ${desktopPackage.version}.exe`,
    `${productName} ${desktopPackage.version}.exe`
  ];
  const signatures = readSignatures(artifactNames);
  if (!Array.isArray(signatures) || signatures.length !== artifactNames.length) {
    throw new Error('Windows Authenticode inspection returned an incomplete result.');
  }
  if (requireSignedRelease && signatures.some(signature => signature.status !== 'Valid' || !signature.signerThumbprint)) {
    throw new Error('MRT_SIGNED_RELEASE requires a valid Authenticode signature on every Windows release executable.');
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
  const { graph, components } = await collectProductionGraph(dependencyTree, licenseIndex, productRef);
  const appArchivePath = join(artifactsRoot, 'win-unpacked/resources/app.asar');
  const appArchiveHash = sha256(await readFile(appArchivePath));
  const toolchain = {
    node: rootPackage.engines.node,
    pnpm: rootPackage.packageManager.replace(/^pnpm@/u, ''),
    electronBuilder: rootPackage.devDependencies['electron-builder']
  };

  const checksumEntries = [];
  for (const [index, artifactName] of artifactNames.entries()) {
    const artifactPath = join(artifactsRoot, artifactName);
    const artifactBytes = await readFile(artifactPath);
    const artifactHash = sha256(artifactBytes);
    const bom = buildBom({ artifactName, artifactHash, appArchiveHash, signature: signatures[index],
      dependencies: graph, components: [...components], desktopPackage, toolchain });
    const bomName = `${artifactName}.cdx.json`;
    const bomPath = join(artifactsRoot, bomName);
    const bomContents = `${JSON.stringify(bom, null, 2)}\n`;
    await writeFile(bomPath, bomContents, { encoding: 'utf8' });
    checksumEntries.push(`${artifactHash}  ${artifactName}`, `${sha256(bomContents)}  ${bomName}`);
  }
  await writeFile(join(artifactsRoot, 'SHA256SUMS.txt'), `${checksumEntries.sort().join('\n')}\n`, 'utf8');
  console.log(`Generated per-artifact CycloneDX 1.6 SBOMs for ${components.length} resolved runtime components; signatures: ${signatures.map(item => item.status).join(', ')}.`);
}

await main();
