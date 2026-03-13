/**
 * Key Store using Dexie (IndexedDB) for secure local key storage
 */

import Dexie, { Table } from "dexie";
import { IdentityKeys, KeyPairData, importPrivateKey, importAesKey, encryptMessage, decryptMessage } from "./crypto";

// Stored identity keys for the local user
interface StoredIdentity {
  id: string; // Always "local" - we only store one identity
  userId: string;
  identityKeyPublic: string;
  identityKeyPrivate: string; // May be encrypted at rest
  signedPreKeyPublic: string;
  signedPreKeyPrivate: string; // May be encrypted at rest
  signedPreKeySignature: string;
  signingKeyPublic: string;
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
  signingKeyPublic?: string;
}

class KeyStoreDatabase extends Dexie {
  identity!: Table<StoredIdentity>;
  preKeys!: Table<StoredPreKey>;
  channelKeys!: Table<StoredChannelKey>;
  userKeys!: Table<StoredUserKey>;

  constructor() {
    super("vibechat-keystore");

    this.version(1).stores({
      identity: "id, userId",
      preKeys: "id, used",
      channelKeys: "channelId",
      userKeys: "userId",
    });

    // v2: Added signingKeyPublic to identity and userKeys
    this.version(2).stores({
      identity: "id, userId",
      preKeys: "id, used",
      channelKeys: "channelId",
      userKeys: "userId",
    });
  }
}

const db = new KeyStoreDatabase();

// Local encryption key for encrypting private keys at rest in IndexedDB
let localEncryptionKey: CryptoKey | null = null;

/**
 * Set the local encryption key (derived from password at login)
 */
export function setLocalEncryptionKey(key: CryptoKey): void {
  localEncryptionKey = key;
}

/**
 * Clear the local encryption key (on logout)
 */
export function clearLocalEncryptionKey(): void {
  localEncryptionKey = null;
}

/**
 * Encrypt a value for storage (if local encryption key is set)
 */
async function encryptForStorage(value: string): Promise<string> {
  if (!localEncryptionKey) return value;
  return await encryptMessage(value, localEncryptionKey);
}

/**
 * Decrypt a value from storage (if local encryption key is set)
 * Falls back to returning the value as-is if decryption fails (migration from unencrypted)
 */
async function decryptFromStorage(value: string): Promise<string> {
  if (!localEncryptionKey) return value;
  try {
    return await decryptMessage(value, localEncryptionKey);
  } catch {
    // Value was stored unencrypted (pre-migration) — return as-is
    return value;
  }
}

/**
 * Store identity keys after registration
 */
export async function storeIdentityKeys(userId: string, keys: IdentityKeys): Promise<void> {
  // Store main identity (encrypt private keys at rest)
  await db.identity.put({
    id: "local",
    userId,
    identityKeyPublic: keys.identityKeyPair.publicKey,
    identityKeyPrivate: await encryptForStorage(keys.identityKeyPair.privateKey),
    signedPreKeyPublic: keys.signedPreKeyPair.publicKey,
    signedPreKeyPrivate: await encryptForStorage(keys.signedPreKeyPair.privateKey),
    signedPreKeySignature: keys.signedPreKeySignature,
    signingKeyPublic: keys.signingKeyPublic || "",
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
  signingKeyPublic: string;
} | null> {
  const identity = await db.identity.get("local");
  if (!identity) return null;

  return {
    userId: identity.userId,
    identityKeyPair: {
      publicKey: identity.identityKeyPublic,
      privateKey: await decryptFromStorage(identity.identityKeyPrivate),
    },
    signedPreKeyPair: {
      publicKey: identity.signedPreKeyPublic,
      privateKey: await decryptFromStorage(identity.signedPreKeyPrivate),
    },
    signingKeyPublic: identity.signingKeyPublic || "",
  };
}

/**
 * Get the identity private key for decryption
 */
export async function getIdentityPrivateKey(): Promise<CryptoKey | null> {
  const identity = await db.identity.get("local");
  if (!identity) return null;

  const decryptedPrivate = await decryptFromStorage(identity.identityKeyPrivate);
  return await importPrivateKey(decryptedPrivate);
}

// Channel key change listeners for backup sync
type ChannelKeyChangeListener = () => void;
const channelKeyChangeListeners = new Set<ChannelKeyChangeListener>();

export function onChannelKeyChange(listener: ChannelKeyChangeListener): () => void {
  channelKeyChangeListeners.add(listener);
  return () => channelKeyChangeListeners.delete(listener);
}

function notifyChannelKeyChange(): void {
  for (const listener of channelKeyChangeListeners) {
    listener();
  }
}

/**
 * Store a channel encryption key
 */
export async function storeChannelKey(channelId: string, keyBase64: string): Promise<void> {
  const encrypted = await encryptForStorage(keyBase64);
  await db.channelKeys.put({ channelId, keyBase64: encrypted });
  notifyChannelKeyChange();
}

/**
 * Get a channel encryption key
 */
export async function getChannelKey(channelId: string): Promise<CryptoKey | null> {
  const stored = await db.channelKeys.get(channelId);
  if (!stored) return null;

  const decrypted = await decryptFromStorage(stored.keyBase64);
  return await importAesKey(decrypted);
}

/**
 * Check if we have a key for a channel
 */
export async function hasChannelKey(channelId: string): Promise<boolean> {
  const stored = await db.channelKeys.get(channelId);
  return stored !== undefined;
}

/**
 * Store another user's public key
 */
export async function storeUserKey(
  userId: string,
  identityKeyPublic: string,
  signedPreKeyPublic: string,
  signingKeyPublic?: string
): Promise<void> {
  await db.userKeys.put({
    userId,
    identityKeyPublic,
    signedPreKeyPublic,
    signingKeyPublic,
  });
}

/**
 * Get a user's public key
 */
export async function getUserKey(userId: string): Promise<StoredUserKey | null> {
  return (await db.userKeys.get(userId)) ?? null;
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
 * Export all channel keys as { channelId: base64Key } map (for backup)
 */
export async function getAllChannelKeys(): Promise<Record<string, string>> {
  const all = await db.channelKeys.toArray();
  const result: Record<string, string> = {};
  for (const entry of all) {
    result[entry.channelId] = await decryptFromStorage(entry.keyBase64);
  }
  return result;
}

/**
 * Bulk-import channel keys (for backup restore)
 */
export async function importAllChannelKeys(keys: Record<string, string>): Promise<void> {
  const entries = Object.entries(keys).map(([channelId, keyBase64]) => ({
    channelId,
    keyBase64,
  }));
  if (entries.length > 0) {
    await db.channelKeys.bulkPut(entries);
    notifyChannelKeyChange();
  }
}

/**
 * Reconstruct full IdentityKeys from IndexedDB (for backup encryption)
 */
export async function getFullIdentityKeysForBackup(): Promise<IdentityKeys | null> {
  const identity = await db.identity.get("local");
  if (!identity) return null;
  const preKeys = await db.preKeys.toArray();
  return {
    identityKeyPair: {
      publicKey: identity.identityKeyPublic,
      privateKey: await decryptFromStorage(identity.identityKeyPrivate),
    },
    signedPreKeyPair: {
      publicKey: identity.signedPreKeyPublic,
      privateKey: await decryptFromStorage(identity.signedPreKeyPrivate),
    },
    signedPreKeySignature: identity.signedPreKeySignature,
    signingKeyPublic: identity.signingKeyPublic || "",
    preKeyPairs: preKeys.map((pk) => ({
      keyId: parseInt(pk.id, 10),
      keyPair: { publicKey: pk.publicKey, privateKey: pk.privateKey },
    })),
  };
}

/**
 * Check if we have identity keys stored
 */
export async function hasIdentityKeys(): Promise<boolean> {
  const identity = await db.identity.get("local");
  return identity !== undefined;
}

/**
 * Regenerate identity keys for an existing user (e.g., after clearing storage)
 * This generates new keys, stores them locally, and updates them on the server.
 *
 * WARNING: This will make any existing encrypted messages unreadable since
 * channel keys encrypted with the old public key cannot be decrypted.
 */
export async function regenerateIdentityKeys(
  userId: string,
  token: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Import the crypto functions dynamically to avoid circular deps
    const { generateIdentityKeys } = await import("./crypto");
    const { api } = await import("./api");

    // Generate fresh identity keys
    const { keys, publicBundle } = await generateIdentityKeys();

    // Store locally first
    await storeIdentityKeys(userId, keys);

    // Update on server
    await api.auth.updateKeys(
      {
        identityKeyPublic: publicBundle.identityKeyPublic,
        signedPreKeyPublic: publicBundle.signedPreKeyPublic,
        signedPreKeySignature: publicBundle.signedPreKeySignature,
        signingKeyPublic: publicBundle.signingKeyPublic,
        preKeys: publicBundle.preKeys,
      },
      token
    );

    // Clear old channel keys since they're encrypted for the old identity
    await db.channelKeys.clear();
    await db.userKeys.clear();

    return { success: true };
  } catch (err) {
    console.error("Failed to regenerate keys:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to regenerate keys",
    };
  }
}
