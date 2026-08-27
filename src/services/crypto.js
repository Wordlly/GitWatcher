import crypto from 'node:crypto';
import { config } from '../config.js';

const legacyKey = crypto
  .createHash('sha256')
  .update(`gitwatcher:mvp:${config.discordToken}`)
  .digest();

const dedicatedKey = config.encryptionKey
  ? crypto.scryptSync(
      config.encryptionKey,
      'gitwatcher:credential-encryption:v2',
      32,
    )
  : null;

function encryptWithKey(plainText, key, version = null) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();
  const pieces = [
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ];

  return version ? [version, ...pieces].join('.') : pieces.join('.');
}

function decryptWithKey(value, key, offset = 0) {
  const pieces = value.split('.');
  const ivText = pieces[offset];
  const tagText = pieces[offset + 1];
  const encryptedText = pieces[offset + 2];

  if (!ivText || !tagText || !encryptedText) {
    throw new Error('Stored credential is invalid.');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivText, 'base64url'),
  );

  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function encryptSecret(plainText) {
  if (dedicatedKey) {
    return encryptWithKey(plainText, dedicatedKey, 'v2');
  }

  return encryptWithKey(plainText, legacyKey);
}

export function decryptSecret(value) {
  if (value.startsWith('v2.')) {
    if (!dedicatedKey) {
      throw new Error(
        'GITWATCHER_ENCRYPTION_KEY is required to decrypt this stored credential.',
      );
    }
    return decryptWithKey(value, dedicatedKey, 1);
  }

  return decryptWithKey(value, legacyKey);
}

export function isLegacySecret(value) {
  return !value.startsWith('v2.');
}

export function hasDedicatedEncryptionKey() {
  return Boolean(dedicatedKey);
}
