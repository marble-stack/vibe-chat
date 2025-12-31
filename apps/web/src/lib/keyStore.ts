/**
 * Key Store using Dexie (IndexedDB) for secure local key storage
 */

import Dexie, { Table } from 'dexie';
import { IdentityKeys, KeyPairData, importPrivateKey, importAesKey } from './crypto';

// Stored identity keys for the local user
interface StoredIdentity {
  id: string; // Always "local" - we only store one identity
  userId: string;
  identityKeyPublic: string;
  identityKeyPrivate: string;
  signedPreKeyPublic: string;
  signedPreKeyPrivate: string;
  signedPreKeySignature: string;
}

// Stored one-time pre-keys
interface StoredPreKey {
  id: string; // keyId
  publicKey: string;
  privateKey: string;
  used: boolean;
}

// Stored channel encryption keys
interface StoredChannelKey {
  channelId: string;
  keyBase64: string;
}

// Known user public keys (for encryption)
interface StoredUserKey {
  userId: string;
  identityKeyPublic: string;
  signedPreKeyPublic: string;
}

class KeyStoreDatabase extends Dexie {
  identity!: Table<StoredIdentity>;
  preKeys!: Table<StoredPreKey>;
  channelKeys!: Table<StoredChannelKey>;
  userKeys!: Table<StoredUserKey>;

  constructor() {
    super('vibechat-keystore');

    this.version(1).stores({
      identity: 'id, userId',
      preKeys: 'id, used',
      channelKeys: 'channelId',
      userKeys: 'userId',
    });
  }
}

const db = new KeyStoreDatabase();

/**
 * Store identity keys after registration
 */
export async function storeIdentityKeys(
  userId: string,
  keys: IdentityKeys
): Promise<void> {
  // Store main identity
  await db.identity.put({
    id: 'local',
    userId,
    identityKeyPublic: keys.identityKeyPair.publicKey,
    identityKeyPrivate: keys.identityKeyPair.privateKey,
    signedPreKeyPublic: keys.signedPreKeyPair.publicKey,
    signedPreKeyPrivate: keys.signedPreKeyPair.privateKey,
    signedPreKeySignature: keys.signedPreKeySignature,
  });

  // Store pre-keys
  for (const preKey of keys.preKeyPairs) {
    await db.preKeys.put({
      id: String(preKey.keyId),
      publicKey: preKey.keyPair.publicKey,
      privateKey: preKey.keyPair.privateKey,
      used: false,
    });
  }
}

/**
 * Get the local user's identity keys
 */
export async function getIdentityKeys(): Promise<{
  userId: string;
  identityKeyPair: KeyPairData;
  signedPreKeyPair: KeyPairData;
} | null> {
  const identity = await db.identity.get('local');
  if (!identity) return null;

  return {
    userId: identity.userId,
    identityKeyPair: {
      publicKey: identity.identityKeyPublic,
      privateKey: identity.identityKeyPrivate,
    },
    signedPreKeyPair: {
      publicKey: identity.signedPreKeyPublic,
      privateKey: identity.signedPreKeyPrivate,
    },
  };
}

/**
 * Get the identity private key for decryption
 */
export async function getIdentityPrivateKey(): Promise<CryptoKey | null> {
  const identity = await db.identity.get('local');
  if (!identity) return null;

  return await importPrivateKey(identity.identityKeyPrivate);
}

/**
 * Store a channel encryption key
 */
export async function storeChannelKey(
  channelId: string,
  keyBase64: string
): Promise<void> {
  await db.channelKeys.put({ channelId, keyBase64 });
}

/**
 * Get a channel encryption key
 */
export async function getChannelKey(channelId: string): Promise<CryptoKey | null> {
  const stored = await db.channelKeys.get(channelId);
  if (!stored) return null;

  return await importAesKey(stored.keyBase64);
}

/**
 * Check if we have a key for a channel
 */
export async function hasChannelKey(channelId: string): Promise<boolean> {
  const stored = await db.channelKeys.get(channelId);
  return stored !== null;
}

/**
 * Store another user's public key
 */
export async function storeUserKey(
  userId: string,
  identityKeyPublic: string,
  signedPreKeyPublic: string
): Promise<void> {
  await db.userKeys.put({
    userId,
    identityKeyPublic,
    signedPreKeyPublic,
  });
}

/**
 * Get a user's public key
 */
export async function getUserKey(userId: string): Promise<StoredUserKey | null> {
  return await db.userKeys.get(userId) ?? null;
}

/**
 * Clear all stored keys (for logout)
 */
export async function clearAllKeys(): Promise<void> {
  await db.identity.clear();
  await db.preKeys.clear();
  await db.channelKeys.clear();
  await db.userKeys.clear();
}

/**
 * Check if we have identity keys stored
 */
export async function hasIdentityKeys(): Promise<boolean> {
  const identity = await db.identity.get('local');
  return identity !== null;
}
