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
import { startTimer, endTimer } from "./perfLogger";
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

/** Error strings returned by decryption when it can't produce plaintext */
const DECRYPTION_ERROR_STRINGS = [
  "[Syncing keys...]",
  "[Unable to decrypt message]",
  "[Encryption not set up - please re-register]",
] as const;

/**
 * Check if a decrypted text is actually a decryption error placeholder.
 * Use this instead of hardcoding error strings in multiple places.
 */
export function isDecryptionError(text: string | undefined): boolean {
  if (!text) return false;
  return (DECRYPTION_ERROR_STRINGS as readonly string[]).includes(text);
}

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
      // Fire-and-forget: don't block sends on key redistribution.
      // The local key is already available for encryption — redistribution
      // only ensures new members receive the key, which isn't urgent for this send.
      distributeChannelKey(channelId, existingKey, members, currentUserId).catch(
        (err) => logger.error("Failed to redistribute channel key:", err)
      );
    }
    return { key: existingKey, isNew: false };
  }

  // Try to fetch channel key from server (someone else may have distributed one)
  const identityKeys = await getIdentityKeys();
  if (!identityKeys) {
    throw new Error("No identity keys found. Please log in again.");
  }

  let senderKeyDecryptionFailed = false;

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
  } catch (err) {
    senderKeyDecryptionFailed = true;
    logger.warn("Sender key decryption failed, keys may be cryptographically broken:", err);
  }

  // No key exists on server for this user - check if ANY key exists in the channel
  try {
    const { senderKeyOwners } = await api.channels.getSenderKeyOwners(channelId);

    if (senderKeyOwners.length > 0) {
      // If sender keys exist but decryption failed (cryptographically broken keys,
      // e.g. identity key mismatch after cross-device login), request redistribution
      // instead of creating a new key. Creating a new key would cause key fragmentation
      // where old messages encrypted with the original key become permanently unreadable.
      if (senderKeyDecryptionFailed && createIfMissing) {
        const keyOwner = senderKeyOwners[0];
        const requestKey = `${channelId}:${keyOwner.userId}`;

        if (!pendingKeyRequests.has(requestKey)) {
          pendingKeyRequests.add(requestKey);
          logger.debug(
            `Requesting key redistribution from ${keyOwner.userId} for channel ${channelId} (sender key decryption failed)`
          );
          wsClient.requestKey(channelId, keyOwner.userId);
          setTimeout(() => pendingKeyRequests.delete(requestKey), 30000);
        }

        throw new Error("Encryption keys are syncing. Please wait a moment and try again.");
      } else {
        // Normal path: A key exists but we don't have it - request redistribution via WebSocket
        const keyOwner = senderKeyOwners[0];
        const requestKey = `${channelId}:${keyOwner.userId}`;

        if (!pendingKeyRequests.has(requestKey)) {
          pendingKeyRequests.add(requestKey);
          logger.debug(
            `Requesting key redistribution from ${keyOwner.userId} for channel ${channelId}`
          );
          wsClient.requestKey(channelId, keyOwner.userId);

          // Remove from pending after 5 seconds to allow faster retry
          setTimeout(() => pendingKeyRequests.delete(requestKey), 5000);
        }

        if (!createIfMissing) {
          throw new Error("Syncing keys...");
        }

        // For sending: wait briefly for key redistribution, then retry
        throw new Error("Syncing channel key. Please try again in a moment.");
      }
    }
  } catch (err) {
    // If this is our "syncing keys" error, re-throw it
    if (err instanceof Error && err.message.toLowerCase().includes("syncing")) {
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

  const results = await Promise.allSettled(
    freshMembers.map(async (member) => {
      const userKeys = await api.auth.getUserKeys(member.id);
      await storeUserKey(member.id, userKeys.identityKey, userKeys.signedPreKey.publicKey);

      const encryptedKey = await encryptChannelKeyForRecipient(
        channelKey,
        privateKey,
        userKeys.identityKey
      );

      return { forUserId: member.id, encryptedKey };
    })
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      encryptedKeys.push(result.value);
    } else {
      logger.error("Failed to encrypt key for a member:", result.reason);
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
  startTimer("encrypt-channel-message");
  const { key } = await ensureChannelKey(channelId, members, currentUserId);
  const result = await encryptMessage(plaintext, key);
  endTimer("encrypt-channel-message");
  return result;
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
      startTimer("decrypt-message");
      const result = await decryptMessage(ciphertext, localKey);
      endTimer("decrypt-message");
      return result;
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

      // Remove from pending after 5 seconds to allow faster retry
      setTimeout(() => pendingKeyRequests.delete(requestKey), 5000);
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

        setTimeout(() => pendingKeyRequests.delete(requestKey), 5000);
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

/**
 * Proactively fetch channel keys for all of the user's communities/channels.
 * Called on login to minimize "[Syncing keys...]" messages when navigating channels.
 * Non-blocking — failures are logged but don't prevent the app from loading.
 */
export async function prefetchAllChannelKeys(currentUserId: string): Promise<string[]> {
  const fetchedChannelIds: string[] = [];

  try {
    const { communities } = await api.communities.list(currentUserId);

    for (const community of communities) {
      try {
        const { channels } = await api.communities.get(community.id);

        // Fetch keys in parallel for all channels in this community
        const results = await Promise.allSettled(
          channels.map(async (channel) => {
            const fetched = await tryFetchChannelKey(channel.id, currentUserId);
            if (fetched) {
              return channel.id;
            }
            // Key not available — request redistribution via WebSocket
            // (will be fulfilled when a key holder is online)
            const { senderKeyOwners } = await api.channels.getSenderKeyOwners(channel.id);
            if (senderKeyOwners.length > 0) {
              const keyOwner = senderKeyOwners[0];
              const requestKey = `${channel.id}:${keyOwner.userId}`;
              if (!pendingKeyRequests.has(requestKey)) {
                pendingKeyRequests.add(requestKey);
                wsClient.requestKey(channel.id, keyOwner.userId);
                setTimeout(() => pendingKeyRequests.delete(requestKey), 30000);
              }
            }
            return null;
          })
        );

        for (const result of results) {
          if (result.status === "fulfilled" && result.value) {
            fetchedChannelIds.push(result.value);
          }
        }
      } catch (err) {
        logger.debug(`Failed to prefetch keys for community ${community.id}:`, err);
      }
    }

    logger.debug("Channel key prefetch complete");
  } catch (err) {
    logger.debug("Failed to prefetch channel keys:", err);
  }

  return fetchedChannelIds;
}
