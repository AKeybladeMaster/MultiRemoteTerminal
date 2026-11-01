export interface ReleaseSignature {
  readonly file: string;
  readonly status: string;
  readonly signerSubject?: string | null;
  readonly signerThumbprint?: string | null;
}

export declare function signedReleaseRequested(value: string | undefined): boolean;
export declare function expectedReleaseSigner(value: string | undefined): string;
export declare function assertReleaseSigners(signatures: readonly ReleaseSignature[], expectedFiles: readonly string[], expectedThumbprint: string): void;
export declare function assertUnsignedReleaseArtifacts(signatures: readonly ReleaseSignature[], expectedFiles: readonly string[]): void;
