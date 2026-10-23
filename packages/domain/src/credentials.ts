const CREDENTIAL_REFERENCE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

declare const credentialReferenceBrand: unique symbol;

export type CredentialReference = string & { readonly [credentialReferenceBrand]: true };

export const MAX_CREDENTIAL_SECRET_LENGTH = 65_536;

export function parseCredentialReference(value: unknown): CredentialReference | undefined {
  return typeof value === 'string' && CREDENTIAL_REFERENCE.test(value) ? value as CredentialReference : undefined;
}

export function isCredentialSecret(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_CREDENTIAL_SECRET_LENGTH;
}
