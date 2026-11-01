export function signedReleaseRequested(value) {
  if (value === undefined || value === '0') return false;
  if (value === '1') return true;
  throw new Error('MRT_SIGNED_RELEASE must be unset, 0, or 1.');
}

export function expectedReleaseSigner(value) {
  if (typeof value !== 'string' || !/^[a-f\d]{40}$/iu.test(value.trim())) {
    throw new Error('MRT_SIGNED_RELEASE requires MRT_RELEASE_SIGNER_SHA1 with the expected 40-character certificate thumbprint.');
  }
  return value.trim().toUpperCase();
}

export function assertReleaseSigners(signatures, expectedFiles, expectedThumbprint) {
  if (!Array.isArray(signatures) || signatures.length !== expectedFiles.length || expectedFiles.some((file, index) => {
    const signature = signatures[index];
    return signature?.file !== file || signature.status !== 'Valid' || typeof signature.signerThumbprint !== 'string' ||
      signature.signerThumbprint.replace(/\s/gu, '').toUpperCase() !== expectedThumbprint;
  })) {
    throw new Error('Every expected Windows release executable must have a valid Authenticode signature from MRT_RELEASE_SIGNER_SHA1.');
  }
}

export function assertUnsignedReleaseArtifacts(signatures, expectedFiles) {
  if (!Array.isArray(signatures) || signatures.length !== expectedFiles.length || expectedFiles.some((file, index) => {
    const signature = signatures[index];
    return !signature || signature.file !== file || signature.status !== 'NotSigned' ||
      (signature.signerThumbprint !== undefined && signature.signerThumbprint !== null) ||
      (signature.signerSubject !== undefined && signature.signerSubject !== null);
  })) {
    throw new Error('Unsigned Windows packaging must produce only the expected unsigned artifacts.');
  }
}
