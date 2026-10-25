import { flipFuses, FuseV1Options, FuseVersion } from '@electron/fuses';
import { join } from 'node:path';

const releaseFuseSettings = {
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  [FuseV1Options.WasmTrapHandlers]: true
};

export default async function applyReleaseFuses(context) {
  if (context.electronPlatformName !== 'win32') return;

  const electronExecutable = join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  await flipFuses(electronExecutable, {
    version: FuseVersion.V1,
    strictlyRequireAllFuses: true,
    ...releaseFuseSettings
  });
}
