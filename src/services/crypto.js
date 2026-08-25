import crypto from 'node:crypto';
import { config } from '../config.js';

const key = crypto
  .createHash('sha256')
  .update(`gitwatcher:mvp:${config.discordToken}`)
  .digest();

export function encryptSecret(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return [
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptSecret(value) {
  const [ivText, tagText, encryptedText] = value.split('.');

  if (!ivText || !tagText || !encryptedText) {
    throw new Error('Stored GitHub credential is invalid.');
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
