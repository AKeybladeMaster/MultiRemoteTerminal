export declare function ensureWorkspaceOutputDirectory(projectRoot: string, components: readonly string[]): Promise<string>;
export declare function ensureWorkspaceTemporaryDirectory(projectRoot: string): Promise<string>;
export declare function writeWorkspaceOutputFile(projectRoot: string, components: readonly string[], fileName: string, contents: string): Promise<string>;
export declare function writeWorkspaceTemporaryNoticeFile(projectRoot: string, contents: string): Promise<string>;

export interface ProductionLicensePackage {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly path: string;
}

export declare function productionLicensePackages(licensesByType: unknown): ProductionLicensePackage[];
export declare function productionPackageIntegrityIndex(lockfileText: string): Map<string, { readonly alg: 'SHA-512'; readonly content: string }>;
export declare function readBoundedRegularFile(candidatePath: string, maxBytes: number): Promise<Buffer>;
export declare function readBoundedLockfile(candidatePath: string): Promise<string>;
export declare function sha256RegularFile(candidatePath: string): Promise<string>;
export declare function readInstalledPackageManifest(candidatePath: string, dependencyRoot: string): Promise<{
  readonly packagePath: string;
  readonly manifest: Record<string, unknown>;
}>;
export declare function publicPackageDistributionUrl(value: unknown): string | undefined;
export declare function buildThirdPartyNotices(packages: readonly ProductionLicensePackage[], dependencyRoot: string): Promise<string>;
