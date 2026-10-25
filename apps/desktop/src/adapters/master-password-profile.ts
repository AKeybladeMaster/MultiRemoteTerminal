export const MASTER_PASSWORD_PROFILE = Object.freeze({
  id: 1,
  kdf: 'argon2id13',
  opsLimit: 2,
  memLimit: 67_108_864,
  keyLength: 32,
  saltLength: 16,
  cipher: 'xchacha20poly1305-ietf',
  nonceLength: 24,
  tagLength: 16
} as const);
