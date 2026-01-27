/**
 * Channel Encryption Service
 *
 * Manages channel keys for E2E encrypted group messaging.
 * Each channel has a shared symmetric key that is distributed
 * to members encrypted with their public keys.
 */

import { api } from "./api";
import { logger } from "./logger";
import { wsClient } from "./websocket";
import {
  generateChannelKey,
  exportAesKey,
  encryptMessage,
  decryptMessage,
  encryptChannelKeyForRecipient,
  decryptChannelKey,
  importPrivateKey,
} from "./crypto";
import {
  getChannelKey,
  storeChannelKey,
  hasChannelKey,
  getIdentityKeys,
  storeUserKey,
  getUserKey,
} from "./keyStore";

// Track pending key requests to avoid duplicate requests
const pendingKeyRequests = new Set<string>();

/**
 * Get or create a channel key for sending messages
 * Returns the key and whether it was newly created
 *
 * @param createIfMissing - If true, create a new key when none exists (use for sending).
 *                          If false, throw an error when no key exists (use for receiving).
 */
export async function ensureChannelKey(
  channelId: string,
  members: { id: string; displayName: string }[],
  currentUserId: string,
  createIfMissing: boolean = true
): Promise<{ key: CryptoKey; isNew: boolean }> {
  // Check if we already have the channel key locally
  const existingKey = await getChannelKey(channelId);
  if (existingKey) {
    // When sending (createIfMissing=true), redistribute key to all current members
    // in case new members joined. This ensures new members can decrypt messages.
    if (createIfMissing && members.length > 0) {
      try {
        await distributeChannelKey(channelId, existingKey, members, currentUserId);
      } catch (err) {
        logger.error("Failed to redistribute channel key:", err);
        // Continue anyway - we still have the key locally
      }
    }
    return { key: existingKey, isNew: false };
  }

  // Try to fetch channel key from server (someone else may have distributed one)
  const identityKeys = await getIdentityKeys();
  if (!identityKeys) {
    throw new Error("No identity keys found. Please log in again.");
  }

  try {
    const { senderKeys } = await api.channels.getSenderKeys(channelId, currentUserId);

    if (senderKeys.length > 0) {
      // We have a sender key from another user - decrypt it
      const senderKey = senderKeys[0]; // Take the first available

      // Use stored sender public key if available (for keys distributed after this fix)
      // Fall back to fetching from server for backward compatibility
      let senderPublicKeyValue = senderKey.senderPublicKey;
      if (!senderPublicKeyValue) {
        // Try local cache first
        const cachedKey = await getUserKey(senderKey.userId);
        if (cachedKey) {
          senderPublicKeyValue = cachedKey.identityKeyPublic;
        } else {
          // Fetch sender's public key from server
          const userKeys = await api.auth.getUserKeys(senderKey.userId);
          senderPublicKeyValue = userKeys.identityKey;
          await storeUserKey(
            senderKey.userId,
            userKeys.identityKey,
            userKeys.signedPreKey.publicKey
          );
        }
      }

      // Decrypt the channel key
      const privateKey = await importPrivateKey(identityKeys.identityKeyPair.privateKey);
      const channelKey = await decryptChannelKey(
        senderKey.encryptedKey,
        privateKey,
        senderPublicKeyValue
      );

      // Store locally
      const keyBase64 = await exportAesKey(channelKey);
      await storeChannelKey(channelId, keyBase64);

      return { key: channelKey, isNew: false };
    }
  } catch (_err) {
    logger.debug("No existing channel key found for current user");
  }

  // No key exists on server for this user - check if ANY key exists in the channel
  try {
    const { senderKeyOwners } = await api.channels.getSenderKeyOwners(channelId);

    if (senderKeyOwners.length > 0) {
      // A key exists but we don't have it - request redistribution via WebSocket
      const keyOwner = senderKeyOwners[0];
      const requestKey = `${channelId}:${keyOwner.userId}`;

      if (!pendingKeyRequests.has(requestKey)) {
        pendingKeyRequests.add(requestKey);
        logger.debug(
          `Requesting key redistribution from ${keyOwner.userId} for channel ${channelId}`
        );
        wsClient.requestKey(channelId, keyOwner.userId);

        // Remove from pending after 30 seconds to allow retry
        setTimeout(() => pendingKeyRequests.delete(requestKey), 30000);
      }

      if (!createIfMissing) {
        throw new Error("Syncing keys...");
      }

      // For sending: wait briefly for key redistribution, then retry
      throw new Error("Syncing channel key. Please try again in a moment.");
    }
  } catch (err) {
    // If this is our "syncing keys" error, re-throw it
    if (err instanceof Error && err.message.includes("Syncing")) {
      throw err;
    }
    // For any other error (e.g., network error), do NOT proceed to create a new key
    // as this could cause key fragmentation. Instead, throw an error to prevent sending.
    // The user can retry when the network is available.
    logger.error("Could not check for existing channel keys:", err);
    throw new Error("Could not verify channel key status. Please try again.");
  }

  // No key exists on server for this user
  if (!createIfMissing) {
    // For decryption, don't create a new key - throw error so caller can handle gracefully
    throw new Error("No channel key available. Waiting for key distribution from another member.");
  }

  // For sending: create and distribute a new key (only if NO key exists at all)
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
 * Exported so it can be called when we receive a key:requested message
 *
 * IMPORTANT: This function fetches fresh members from the API to ensure
 * new members who joined after the UI loaded will receive the key.
 */
export async function distributeChannelKey(
  channelId: string,
  channelKey: CryptoKey,
  _members: { id: string }[], // Deprecated: members are now fetched from API
  currentUserId: string
): Promise<void> {
  const identityKeys = await getIdentityKeys();
  if (!identityKeys) {
    throw new Error("No identity keys found");
  }

  // Fetch fresh member list from API to ensure new members are included
  // This fixes the stale member list issue where new members wouldn't receive keys
  let freshMembers: { id: string }[];
  try {
    const { members } = await api.channels.getMembers(channelId);
    freshMembers = members;
    logger.debug(`Fetched ${freshMembers.length} fresh members for key distribution`);
  } catch (err) {
    logger.error("Failed to fetch fresh members, using provided list:", err);
    // Fall back to provided members if API fails (better than nothing)
    freshMembers = _members;
  }

  const privateKey = await importPrivateKey(identityKeys.identityKeyPair.privateKey);
  const encryptedKeys: { forUserId: string; encryptedKey: string }[] = [];

  for (const member of freshMembers) {
    try {
      // Always fetch fresh keys from server to handle key regeneration
      // Users may have regenerated their keys on a new device
      const userKeys = await api.auth.getUserKeys(member.id);
      const memberKey = {
        userId: member.id,
        identityKeyPublic: userKeys.identityKey,
        signedPreKeyPublic: userKeys.signedPreKey.publicKey,
      };
      // Update local cache with fresh keys
      await storeUserKey(member.id, userKeys.identityKey, userKeys.signedPreKey.publicKey);

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
      logger.error(`Failed to encrypt key for member ${member.id}:`, err);
    }
  }

  // Send to server - throw error if no keys could be encrypted
  if (encryptedKeys.length === 0) {
    throw new Error("Failed to encrypt key for any members");
  }

  await api.channels.distributeSenderKey({
    channelId,
    userId: currentUserId,
    distributionId: crypto.randomUUID(),
    // Include sender's public key for decryption after key rotation
    senderPublicKey: identityKeys.identityKeyPair.publicKey,
    encryptedKeys,
  });
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
  _members: { id: string; displayName: string }[],
  currentUserId: string,
  senderId?: string
): Promise<string> {
  // Check if we have identity keys - if not, encryption is not set up
  const identityKeys = await getIdentityKeys();
  if (!identityKeys) {
    logger.warn("No identity keys found - encryption not set up for this device");
    return "[Encryption not set up - please re-register]";
  }

  // First try with local key if we have one
  const localKey = await getChannelKey(channelId);
  if (localKey) {
    try {
      return await decryptMessage(ciphertext, localKey);
    } catch {
      // Local key didn't work - might be stale, try fetching fresh key from server
      logger.debug("Local key failed to decrypt, trying to fetch fresh key from server");
    }
  }

  // Try to fetch fresh key from server
  try {
    const { senderKeys } = await api.channels.getSenderKeys(channelId, currentUserId);

    if (senderKeys.length > 0) {
      const privateKey = await importPrivateKey(identityKeys.identityKeyPair.privateKey);

      // Try each sender key until one works
      for (const senderKey of senderKeys) {
        try {
          // Use stored sender public key if available (for keys distributed after this fix)
          // Fall back to fetching from server for backward compatibility
          let senderPublicKey = senderKey.senderPublicKey;
          if (!senderPublicKey) {
            const userKeys = await api.auth.getUserKeys(senderKey.userId);
            senderPublicKey = userKeys.identityKey;
          }

          const channelKey = await decryptChannelKey(
            senderKey.encryptedKey,
            privateKey,
            senderPublicKey
          );

          // Store the working key locally
          const keyBase64 = await exportAesKey(channelKey);
          await storeChannelKey(channelId, keyBase64);

          // Try to decrypt the message
          return await decryptMessage(ciphertext, channelKey);
        } catch {
          // This sender key didn't work, try next one
          continue;
        }
      }
    }
  } catch (err) {
    logger.error("Failed to fetch keys from server:", err);
  }

  // Could not decrypt - request key from the sender if we know who they are
  // Note: We request even for our own messages, as another device may have the key
  if (senderId) {
    const requestKey = `${channelId}:${senderId}`;
    if (!pendingKeyRequests.has(requestKey)) {
      pendingKeyRequests.add(requestKey);
      logger.debug(`Requesting key from sender ${senderId} for channel ${channelId}`);
      wsClient.requestKey(channelId, senderId);

      // Remove from pending after 30 seconds to allow retry
      setTimeout(() => pendingKeyRequests.delete(requestKey), 30000);
    }
    return "[Syncing keys...]";
  }

  // Check if ANY key exists in the channel and request it
  try {
    const { senderKeyOwners } = await api.channels.getSenderKeyOwners(channelId);
    if (senderKeyOwners.length > 0) {
      const keyOwner = senderKeyOwners[0];
      const requestKey = `${channelId}:${keyOwner.userId}`;
      if (!pendingKeyRequests.has(requestKey)) {
        pendingKeyRequests.add(requestKey);
        logger.debug(`Requesting key redistribution from ${keyOwner.userId}`);
        wsClient.requestKey(channelId, keyOwner.userId);

        setTimeout(() => pendingKeyRequests.delete(requestKey), 30000);
      }
      return "[Syncing keys...]";
    }
  } catch {
    // Ignore error checking for key owners
  }

  return "[Unable to decrypt message]";
}

/**
 * Check if we can encrypt/decrypt in a channel (have the key)
 */
export async function canEncryptInChannel(channelId: string): Promise<boolean> {
  return await hasChannelKey(channelId);
}

/**
 * Clear a pending key request (called when key is received)
 */
export function clearPendingKeyRequest(channelId: string, userId: string): void {
  const requestKey = `${channelId}:${userId}`;
  pendingKeyRequests.delete(requestKey);
}

/**
 * Try to fetch and store a channel key from the server.
 * Returns true if a new key was successfully fetched.
 * This is used for polling when the key owner may have been offline.
 */
export async function tryFetchChannelKey(
  channelId: string,
  currentUserId: string
): Promise<boolean> {
  // Check if we already have the key
  if (await hasChannelKey(channelId)) {
    return false;
  }

  const identityKeys = await getIdentityKeys();
  if (!identityKeys) {
    return false;
  }

  try {
    const { senderKeys } = await api.channels.getSenderKeys(channelId, currentUserId);

    if (senderKeys.length > 0) {
      const senderKey = senderKeys[0];
      const privateKey = await importPrivateKey(identityKeys.identityKeyPair.privateKey);

      let senderPublicKeyValue = senderKey.senderPublicKey;
      if (!senderPublicKeyValue) {
        const cachedKey = await getUserKey(senderKey.userId);
        if (cachedKey) {
          senderPublicKeyValue = cachedKey.identityKeyPublic;
        } else {
          const userKeys = await api.auth.getUserKeys(senderKey.userId);
          senderPublicKeyValue = userKeys.identityKey;
          await storeUserKey(
            senderKey.userId,
            userKeys.identityKey,
            userKeys.signedPreKey.publicKey
          );
        }
      }

      const channelKey = await decryptChannelKey(
        senderKey.encryptedKey,
        privateKey,
        senderPublicKeyValue
      );

      const keyBase64 = await exportAesKey(channelKey);
      await storeChannelKey(channelId, keyBase64);

      // Clear pending request since we got the key
      clearPendingKeyRequest(channelId, senderKey.userId);

      logger.debug(`Successfully fetched channel key for ${channelId}`);
      return true;
    }
  } catch (err) {
    logger.debug("Failed to fetch channel key:", err);
  }

  return false;
}
