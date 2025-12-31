/**
 * Channel Encryption Service
 *
 * Manages channel keys for E2E encrypted group messaging.
 * Each channel has a shared symmetric key that is distributed
 * to members encrypted with their public keys.
 */

import { api } from './api';
import {
  generateChannelKey,
  exportAesKey,
  encryptMessage,
  decryptMessage,
  encryptChannelKeyForRecipient,
  decryptChannelKey,
  importPrivateKey,
} from './crypto';
import {
  getChannelKey,
  storeChannelKey,
  hasChannelKey,
  getIdentityKeys,
  storeUserKey,
  getUserKey,
} from './keyStore';

/**
 * Get or create a channel key for sending messages
 * Returns the key and whether it was newly created
 */
export async function ensureChannelKey(
  channelId: string,
  members: { id: string; displayName: string }[],
  currentUserId: string
): Promise<{ key: CryptoKey; isNew: boolean }> {
  // Check if we already have the channel key locally
  const existingKey = await getChannelKey(channelId);
  if (existingKey) {
    return { key: existingKey, isNew: false };
  }

  // Try to fetch channel key from server (someone else may have distributed one)
  const identityKeys = await getIdentityKeys();
  if (!identityKeys) {
    throw new Error('No identity keys found. Please log in again.');
  }

  try {
    const { senderKeys } = await api.channels.getSenderKeys(channelId, currentUserId);

    if (senderKeys.length > 0) {
      // We have a sender key from another user - decrypt it
      const senderKey = senderKeys[0]; // Take the first available

      // Get the sender's public key
      let senderPublicKey = await getUserKey(senderKey.userId);

      if (!senderPublicKey) {
        // Fetch sender's public key from server
        const userKeys = await api.auth.getUserKeys(senderKey.userId);
        senderPublicKey = {
          userId: senderKey.userId,
          identityKeyPublic: userKeys.identityKey,
          signedPreKeyPublic: userKeys.signedPreKey.publicKey,
        };
        await storeUserKey(
          senderKey.userId,
          userKeys.identityKey,
          userKeys.signedPreKey.publicKey
        );
      }

      // Decrypt the channel key
      const privateKey = await importPrivateKey(identityKeys.identityKeyPair.privateKey);
      const channelKey = await decryptChannelKey(
        senderKey.encryptedKey,
        privateKey,
        senderPublicKey.identityKeyPublic
      );

      // Store locally
      const keyBase64 = await exportAesKey(channelKey);
      await storeChannelKey(channelId, keyBase64);

      return { key: channelKey, isNew: false };
    }
  } catch (err) {
    console.log('No existing channel key found, will create new one');
  }

  // No key exists - we need to create and distribute one
  const channelKey = await generateChannelKey();
  const keyBase64 = await exportAesKey(channelKey);

  // Store locally first
  await storeChannelKey(channelId, keyBase64);

  // Distribute to all members
  await distributeChannelKey(channelId, channelKey, members, currentUserId);

  return { key: channelKey, isNew: true };
}

/**
 * Distribute a channel key to all members
 */
async function distributeChannelKey(
  channelId: string,
  channelKey: CryptoKey,
  members: { id: string }[],
  currentUserId: string
): Promise<void> {
  const identityKeys = await getIdentityKeys();
  if (!identityKeys) {
    throw new Error('No identity keys found');
  }

  const privateKey = await importPrivateKey(identityKeys.identityKeyPair.privateKey);
  const encryptedKeys: { forUserId: string; encryptedKey: string }[] = [];

  for (const member of members) {
    try {
      // Get or fetch member's public key
      let memberKey = await getUserKey(member.id);

      if (!memberKey) {
        const userKeys = await api.auth.getUserKeys(member.id);
        memberKey = {
          userId: member.id,
          identityKeyPublic: userKeys.identityKey,
          signedPreKeyPublic: userKeys.signedPreKey.publicKey,
        };
        await storeUserKey(member.id, userKeys.identityKey, userKeys.signedPreKey.publicKey);
      }

      // Encrypt channel key for this member
      const encryptedKey = await encryptChannelKeyForRecipient(
        channelKey,
        privateKey,
        memberKey.identityKeyPublic
      );

      encryptedKeys.push({
        forUserId: member.id,
        encryptedKey,
      });
    } catch (err) {
      console.error(`Failed to encrypt key for member ${member.id}:`, err);
    }
  }

  // Send to server
  if (encryptedKeys.length > 0) {
    await api.channels.distributeSenderKey({
      channelId,
      userId: currentUserId,
      distributionId: crypto.randomUUID(),
      encryptedKeys,
    });
  }
}

/**
 * Encrypt a message for a channel
 */
export async function encryptChannelMessage(
  channelId: string,
  plaintext: string,
  members: { id: string; displayName: string }[],
  currentUserId: string
): Promise<string> {
  const { key } = await ensureChannelKey(channelId, members, currentUserId);
  return await encryptMessage(plaintext, key);
}

/**
 * Decrypt a message from a channel
 */
export async function decryptChannelMessage(
  channelId: string,
  ciphertext: string,
  members: { id: string; displayName: string }[],
  currentUserId: string
): Promise<string> {
  try {
    const { key } = await ensureChannelKey(channelId, members, currentUserId);
    return await decryptMessage(ciphertext, key);
  } catch (err) {
    // If decryption fails, return placeholder
    console.error('Failed to decrypt message:', err);
    return '[Unable to decrypt message]';
  }
}

/**
 * Check if we can encrypt/decrypt in a channel (have the key)
 */
export async function canEncryptInChannel(channelId: string): Promise<boolean> {
  return await hasChannelKey(channelId);
}
