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

// Throttle redistribution to avoid excessive API calls on every message send
const lastRedistributionTime = new Map<string, number>();
const REDISTRIBUTION_COOLDOWN_MS = 10_000; // 10 seconds

// Track when we first requested redistribution for each channel (deadlock breaker)
// If we've been waiting > REDISTRIBUTION_TIMEOUT_MS and still no key, the other owner
// likely also has a broken key. Break the deadlock by creating a new key.
const redistributionRequestStart = new Map<string, number>();
const REDISTRIBUTION_TIMEOUT_MS = 30_000; // 30 seconds

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
    // Throttled to once per 60s per channel to avoid excessive API calls.
    if (createIfMissing && members.length > 0) {
      const now = Date.now();
      const lastTime = lastRedistributionTime.get(channelId) || 0;
      if (now - lastTime > REDISTRIBUTION_COOLDOWN_MS) {
        lastRedistributionTime.set(channelId, now);
        // Await redistribution with a 5s timeout so keys are on the server
        // before the message is broadcast. Falls back to fire-and-forget on timeout.
        try {
          await Promise.race([
            distributeChannelKey(channelId, existingKey, members, currentUserId),
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error("Key redistribution timeout")), 5000)
            ),
          ]);
        } catch (err) {
          logger.error("Failed to redistribute channel key (continuing send):", err);
        }
      }
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
      // We have sender keys from other users - try each one until one works
      // (same pattern as decryptChannelMessage)
      const privateKey = await importPrivateKey(identityKeys.identityKeyPair.privateKey);

      for (const senderKey of senderKeys) {
        try {
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

          // Try to decrypt the channel key
          const channelKey = await decryptChannelKey(
            senderKey.encryptedKey,
            privateKey,
            senderPublicKeyValue
          );

          // Success! Store locally
          const keyBase64 = await exportAesKey(channelKey);
          await storeChannelKey(channelId, keyBase64);

          // Clear deadlock timeout tracker since we got the key
          redistributionRequestStart.delete(channelId);

          return { key: channelKey, isNew: false };
        } catch (err) {
          // This key didn't work, try the next one
          logger.debug(`Sender key from ${senderKey.userId} failed to decrypt, trying next`);
          continue;
        }
      }

      // All keys failed - mark as decryption failure
      senderKeyDecryptionFailed = true;
      logger.warn("All sender keys failed to decrypt, keys may be cryptographically broken");
    }
  } catch (err) {
    // Network or other error fetching keys
    logger.error("Failed to fetch sender keys:", err);
    throw new Error("Could not fetch channel keys. Please try again.");
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
        // Check if there's another user who can redistribute.
        // If the only key owner is the current user, the old key is irrecoverable
        // (e.g. re-registration wiped local keys) — fall through to create a new key.
        const otherOwner = senderKeyOwners.find(
          (o) => o.userId !== currentUserId && members.some((m) => m.id === o.userId)
        );
        if (otherOwner) {
          const requestKey = `${channelId}:${otherOwner.userId}`;
          const now = Date.now();
          const startTime = redistributionRequestStart.get(channelId);

          // If we've been waiting > 30s, the other owner can't help (likely also has broken key)
          // Break the deadlock by creating a new key
          if (startTime && now - startTime > REDISTRIBUTION_TIMEOUT_MS) {
            logger.warn(
              `Key redistribution timeout for channel ${channelId} — other owner likely also has broken key. Creating new channel key.`
            );
            redistributionRequestStart.delete(channelId);
            // Fall through to create new key
          } else {
            // Start/continue waiting for redistribution
            if (!startTime) {
              redistributionRequestStart.set(channelId, now);
            }

            if (!pendingKeyRequests.has(requestKey)) {
              pendingKeyRequests.add(requestKey);
              logger.debug(
                `Requesting key redistribution from ${otherOwner.userId} for channel ${channelId} (sender key decryption failed)`
              );
              wsClient.requestKey(channelId, otherOwner.userId);
              setTimeout(() => pendingKeyRequests.delete(requestKey), 30000);
            }

            throw new Error("Encryption keys are syncing. Please wait a moment and try again.");
          }
        }
        // No other owner OR timeout — old key is irrecoverable, create a new one below
        logger.warn(
          `Only key owner for channel ${channelId} is current user with broken key — creating new channel key`
        );
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
  currentUserId: string,
  force?: boolean
): Promise<boolean> {
  // Check if we already have the key — skip when force=true (e.g. key:available just fired)
  if (!force && await hasChannelKey(channelId)) {
    return false; // Key exists but wasn't newly fetched — callers use false to trigger redistribution
  }

  const identityKeys = await getIdentityKeys();
  if (!identityKeys) {
    return false;
  }

  try {
    const { senderKeys } = await api.channels.getSenderKeys(channelId, currentUserId);

    if (senderKeys.length > 0) {
      const privateKey = await importPrivateKey(identityKeys.identityKeyPair.privateKey);

      // Try each sender key until one works (same pattern as decryptChannelMessage)
      for (const senderKey of senderKeys) {
        try {
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

          // Clear pending request and deadlock timeout since we got the key
          clearPendingKeyRequest(channelId, senderKey.userId);
          redistributionRequestStart.delete(channelId);

          logger.debug(`Successfully fetched channel key for ${channelId}`);
          return true;
        } catch (err) {
          // This sender key didn't work, try next one
          logger.debug(`Sender key from ${senderKey.userId} failed in tryFetchChannelKey, trying next`);
          continue;
        }
      }

      // All keys failed - request redistribution
      logger.warn("All sender keys failed to decrypt in tryFetchChannelKey");
      // Request redistribution so the key owner re-encrypts for our current identity key
      try {
        const { senderKeyOwners } = await api.channels.getSenderKeyOwners(channelId);
        if (senderKeyOwners.length > 0) {
          const keyOwner = senderKeyOwners[0];
          const requestKey = `${channelId}:${keyOwner.userId}`;
          if (!pendingKeyRequests.has(requestKey)) {
            pendingKeyRequests.add(requestKey);
            wsClient.requestKey(channelId, keyOwner.userId);
            setTimeout(() => pendingKeyRequests.delete(requestKey), 30000);
          }
        }
      } catch { /* ignore */ }
    }
  } catch (err) {
    // Network error fetching sender keys
    logger.error("Failed to fetch sender keys in tryFetchChannelKey:", err);
  }

  return false;
}

/**
 * Fetch channel keys for an already-known list of channel IDs.
 * Use this when the caller already has channel IDs (e.g. from the chat store)
 * to avoid redundant communities.list + communities.get API calls.
 */
export async function prefetchChannelKeysByIds(
  channelIds: string[],
  currentUserId: string
): Promise<string[]> {
  const fetchedChannelIds: string[] = [];

  const results = await Promise.allSettled(
    channelIds.map(async (channelId) => {
      const fetched = await tryFetchChannelKey(channelId, currentUserId);
      if (fetched) return channelId;

      // Key not available — request redistribution via WebSocket
      const { senderKeyOwners } = await api.channels.getSenderKeyOwners(channelId);
      if (senderKeyOwners.length > 0) {
        const keyOwner = senderKeyOwners[0];
        const requestKey = `${channelId}:${keyOwner.userId}`;
        if (!pendingKeyRequests.has(requestKey)) {
          pendingKeyRequests.add(requestKey);
          wsClient.requestKey(channelId, keyOwner.userId);
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

  return fetchedChannelIds;
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
