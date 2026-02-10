/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateChannelKey,
  exportAesKey,
  importAesKey,
  encryptMessage,
  decryptMessage,
  generateKeyPair,
  exportPublicKey,
  exportPrivateKey,
} from "../../lib/crypto";

// Mock dependencies
vi.mock("../../lib/api", () => ({
  api: {
    channels: {
      getSenderKeys: vi.fn(),
      getSenderKeyOwners: vi.fn(),
      distributeSenderKey: vi.fn(),
      getMembers: vi.fn(),
    },
    auth: {
      getUserKeys: vi.fn(),
    },
  },
}));

vi.mock("../../lib/websocket", () => ({
  wsClient: {
    requestKey: vi.fn(),
  },
}));

vi.mock("../../lib/keyStore", () => ({
  getChannelKey: vi.fn(),
  storeChannelKey: vi.fn(),
  hasChannelKey: vi.fn(),
  getIdentityKeys: vi.fn(),
  storeUserKey: vi.fn(),
  getUserKey: vi.fn(),
}));

vi.mock("../../lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe("Channel Crypto Module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Channel Key Generation", () => {
    it("should generate a valid AES-256-GCM channel key", async () => {
      const key = await generateChannelKey();

      expect(key).toBeDefined();
      expect(key.algorithm.name).toBe("AES-GCM");
      expect((key.algorithm as AesKeyAlgorithm).length).toBe(256);
    });

    it("should generate unique keys each time", async () => {
      const key1 = await generateChannelKey();
      const key2 = await generateChannelKey();

      const exported1 = await exportAesKey(key1);
      const exported2 = await exportAesKey(key2);

      expect(exported1).not.toBe(exported2);
    });

    it("should export and import channel keys correctly", async () => {
      const originalKey = await generateChannelKey();
      const exported = await exportAesKey(originalKey);
      const importedKey = await importAesKey(exported);

      // Verify the imported key works for encryption/decryption
      const testMessage = "Hello, encrypted world!";
      const ciphertext = await encryptMessage(testMessage, originalKey);
      const decrypted = await decryptMessage(ciphertext, importedKey);

      expect(decrypted).toBe(testMessage);
    });
  });

  describe("Message Encryption/Decryption", () => {
    it("should encrypt and decrypt messages with channel key", async () => {
      const channelKey = await generateChannelKey();
      const plaintext = "Secret message for the channel";

      const ciphertext = await encryptMessage(plaintext, channelKey);
      const decrypted = await decryptMessage(ciphertext, channelKey);

      expect(decrypted).toBe(plaintext);
    });

    it("should produce different ciphertext for same message (unique IV)", async () => {
      const channelKey = await generateChannelKey();
      const plaintext = "Same message twice";

      const ciphertext1 = await encryptMessage(plaintext, channelKey);
      const ciphertext2 = await encryptMessage(plaintext, channelKey);

      expect(ciphertext1).not.toBe(ciphertext2);
    });

    it("should fail to decrypt with wrong key", async () => {
      const key1 = await generateChannelKey();
      const key2 = await generateChannelKey();
      const plaintext = "Message encrypted with key1";

      const ciphertext = await encryptMessage(plaintext, key1);

      await expect(decryptMessage(ciphertext, key2)).rejects.toThrow();
    });

    it("should handle empty messages", async () => {
      const channelKey = await generateChannelKey();
      const plaintext = "";

      const ciphertext = await encryptMessage(plaintext, channelKey);
      const decrypted = await decryptMessage(ciphertext, channelKey);

      expect(decrypted).toBe(plaintext);
    });

    it("should handle unicode and emoji", async () => {
      const channelKey = await generateChannelKey();
      const plaintext = "Hello 世界! 🎉🔐 Привет";

      const ciphertext = await encryptMessage(plaintext, channelKey);
      const decrypted = await decryptMessage(ciphertext, channelKey);

      expect(decrypted).toBe(plaintext);
    });

    it("should handle long messages", async () => {
      const channelKey = await generateChannelKey();
      const plaintext = "A".repeat(10000);

      const ciphertext = await encryptMessage(plaintext, channelKey);
      const decrypted = await decryptMessage(ciphertext, channelKey);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe("Key Distribution Helpers", () => {
    it("should generate valid ECDH key pairs for key exchange", async () => {
      const keyPair = await generateKeyPair();

      expect(keyPair.publicKey).toBeDefined();
      expect(keyPair.privateKey).toBeDefined();
      expect(keyPair.publicKey.algorithm.name).toBe("ECDH");
      expect(keyPair.privateKey.algorithm.name).toBe("ECDH");
    });

    it("should export public keys to base64 format", async () => {
      const keyPair = await generateKeyPair();
      const exported = await exportPublicKey(keyPair.publicKey);

      expect(typeof exported).toBe("string");
      expect(exported.length).toBeGreaterThan(0);
      // Base64 should not contain newlines or spaces
      expect(exported).not.toMatch(/[\s\n]/);
    });

    it("should export private keys to JWK format", async () => {
      const keyPair = await generateKeyPair();
      const exported = await exportPrivateKey(keyPair.privateKey);

      const jwk = JSON.parse(exported);
      expect(jwk.kty).toBe("EC");
      expect(jwk.crv).toBe("P-256");
      expect(jwk.d).toBeDefined(); // Private key component
    });
  });
});

describe("Channel Crypto Integration", () => {
  // These tests require the actual channelCrypto module
  // We import it dynamically to control mocking

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset module cache to get fresh imports with new mocks
    vi.resetModules();
  });

  describe("ensureChannelKey", () => {
    it("should return existing local key if available", async () => {
      const { getChannelKey } = await import("../../lib/keyStore");
      const { ensureChannelKey } = await import("../../lib/channelCrypto");

      // Create a real key to return
      const mockKey = await generateChannelKey();
      vi.mocked(getChannelKey).mockResolvedValue(mockKey);

      const result = await ensureChannelKey(
        "channel-123",
        [{ id: "user-1", displayName: "User 1" }],
        "user-1",
        true
      );

      expect(result.key).toBe(mockKey);
      expect(result.isNew).toBe(false);
    });

    it("should throw error when no identity keys exist", async () => {
      const { getChannelKey, getIdentityKeys } = await import("../../lib/keyStore");
      const { ensureChannelKey } = await import("../../lib/channelCrypto");

      vi.mocked(getChannelKey).mockResolvedValue(null);
      vi.mocked(getIdentityKeys).mockResolvedValue(null);

      await expect(
        ensureChannelKey("channel-123", [], "user-1", true)
      ).rejects.toThrow("No identity keys found");
    });

    it("should fetch key from server when not available locally", async () => {
      const {
        getChannelKey,
        getIdentityKeys,
        storeChannelKey,
        getUserKey,
        storeUserKey,
      } = await import("../../lib/keyStore");
      const { api } = await import("../../lib/api");
      const { ensureChannelKey } = await import("../../lib/channelCrypto");

      // Generate real keys for the test
      const senderKeyPair = await generateKeyPair();
      const recipientKeyPair = await generateKeyPair();
      const channelKey = await generateChannelKey();

      // Encrypt the channel key for the recipient
      const { encryptChannelKeyForRecipient } = await import("../../lib/crypto");
      const senderPublicKey = await exportPublicKey(senderKeyPair.publicKey);
      const recipientPublicKey = await exportPublicKey(recipientKeyPair.publicKey);
      const recipientPrivateKey = await exportPrivateKey(recipientKeyPair.privateKey);

      const encryptedKey = await encryptChannelKeyForRecipient(
        channelKey,
        senderKeyPair.privateKey,
        recipientPublicKey
      );

      // Mock the key store
      vi.mocked(getChannelKey).mockResolvedValue(null);
      vi.mocked(getIdentityKeys).mockResolvedValue({
        userId: "user-1",
        identityKeyPair: {
          publicKey: recipientPublicKey,
          privateKey: recipientPrivateKey,
        },
        signedPreKeyPair: {
          publicKey: "signed-pub",
          privateKey: "signed-priv",
        },
      });
      vi.mocked(getUserKey).mockResolvedValue(null);
      vi.mocked(storeUserKey).mockResolvedValue(undefined);
      vi.mocked(storeChannelKey).mockResolvedValue(undefined);

      // Mock API responses
      vi.mocked(api.channels.getSenderKeys).mockResolvedValue({
        senderKeys: [
          {
            userId: "sender-1",
            distributionId: "dist-1",
            encryptedKey: encryptedKey,
            senderPublicKey: senderPublicKey,
          },
        ],
      });

      const result = await ensureChannelKey(
        "channel-123",
        [{ id: "user-1", displayName: "User 1" }],
        "user-1",
        true
      );

      expect(result.key).toBeDefined();
      expect(result.isNew).toBe(false);
      expect(storeChannelKey).toHaveBeenCalled();
    });

    it("should request key via WebSocket when key exists but not for current user", async () => {
      const { getChannelKey, getIdentityKeys } = await import("../../lib/keyStore");
      const { api } = await import("../../lib/api");
      const { wsClient } = await import("../../lib/websocket");
      const { ensureChannelKey } = await import("../../lib/channelCrypto");

      const recipientKeyPair = await generateKeyPair();
      const recipientPublicKey = await exportPublicKey(recipientKeyPair.publicKey);
      const recipientPrivateKey = await exportPrivateKey(recipientKeyPair.privateKey);

      vi.mocked(getChannelKey).mockResolvedValue(null);
      vi.mocked(getIdentityKeys).mockResolvedValue({
        userId: "user-1",
        identityKeyPair: {
          publicKey: recipientPublicKey,
          privateKey: recipientPrivateKey,
        },
        signedPreKeyPair: {
          publicKey: "signed-pub",
          privateKey: "signed-priv",
        },
      });

      // No sender keys for this user
      vi.mocked(api.channels.getSenderKeys).mockResolvedValue({ senderKeys: [] });

      // But a key owner exists
      vi.mocked(api.channels.getSenderKeyOwners).mockResolvedValue({
        senderKeyOwners: [{ userId: "owner-1", senderPublicKey: "owner-pub" }],
      });

      // Should throw syncing error for createIfMissing=false
      await expect(
        ensureChannelKey("channel-123", [], "user-1", false)
      ).rejects.toThrow("Syncing keys...");

      expect(wsClient.requestKey).toHaveBeenCalledWith("channel-123", "owner-1");
    });

    it("should create new key when no key exists in channel", async () => {
      const {
        getChannelKey,
        getIdentityKeys,
        storeChannelKey,
        storeUserKey,
      } = await import("../../lib/keyStore");
      const { api } = await import("../../lib/api");
      const { ensureChannelKey } = await import("../../lib/channelCrypto");

      const userKeyPair = await generateKeyPair();
      const userPublicKey = await exportPublicKey(userKeyPair.publicKey);
      const userPrivateKey = await exportPrivateKey(userKeyPair.privateKey);

      vi.mocked(getChannelKey).mockResolvedValue(null);
      vi.mocked(getIdentityKeys).mockResolvedValue({
        userId: "user-1",
        identityKeyPair: {
          publicKey: userPublicKey,
          privateKey: userPrivateKey,
        },
        signedPreKeyPair: {
          publicKey: "signed-pub",
          privateKey: "signed-priv",
        },
      });
      vi.mocked(storeChannelKey).mockResolvedValue(undefined);
      vi.mocked(storeUserKey).mockResolvedValue(undefined);

      // No sender keys exist
      vi.mocked(api.channels.getSenderKeys).mockResolvedValue({ senderKeys: [] });
      vi.mocked(api.channels.getSenderKeyOwners).mockResolvedValue({
        senderKeyOwners: [],
      });

      // Mock member fetching and key distribution
      vi.mocked(api.channels.getMembers).mockResolvedValue({
        members: [{ id: "user-1", displayName: "User 1" }],
      });
      vi.mocked(api.auth.getUserKeys).mockResolvedValue({
        identityKey: userPublicKey,
        signedPreKey: { publicKey: "signed-pub", signature: "sig" },
        preKey: null,
      });
      vi.mocked(api.channels.distributeSenderKey).mockResolvedValue({
        success: true,
      });

      const result = await ensureChannelKey(
        "channel-123",
        [{ id: "user-1", displayName: "User 1" }],
        "user-1",
        true
      );

      expect(result.key).toBeDefined();
      expect(result.isNew).toBe(true);
      expect(storeChannelKey).toHaveBeenCalled();
      expect(api.channels.distributeSenderKey).toHaveBeenCalled();
    });
  });

  describe("decryptChannelMessage", () => {
    it("should return error message when no identity keys", async () => {
      const { getIdentityKeys } = await import("../../lib/keyStore");
      const { decryptChannelMessage } = await import("../../lib/channelCrypto");

      vi.mocked(getIdentityKeys).mockResolvedValue(null);

      const result = await decryptChannelMessage(
        "channel-123",
        "encrypted-data",
        [],
        "user-1"
      );

      expect(result).toBe("[Encryption not set up - please re-register]");
    });

    it("should decrypt with local key when available", async () => {
      const { getIdentityKeys, getChannelKey } = await import("../../lib/keyStore");
      const { decryptChannelMessage } = await import("../../lib/channelCrypto");

      const channelKey = await generateChannelKey();
      const plaintext = "Hello, world!";
      const ciphertext = await encryptMessage(plaintext, channelKey);

      const userKeyPair = await generateKeyPair();
      const userPublicKey = await exportPublicKey(userKeyPair.publicKey);
      const userPrivateKey = await exportPrivateKey(userKeyPair.privateKey);

      vi.mocked(getIdentityKeys).mockResolvedValue({
        userId: "user-1",
        identityKeyPair: {
          publicKey: userPublicKey,
          privateKey: userPrivateKey,
        },
        signedPreKeyPair: {
          publicKey: "signed-pub",
          privateKey: "signed-priv",
        },
      });
      vi.mocked(getChannelKey).mockResolvedValue(channelKey);

      const result = await decryptChannelMessage(
        "channel-123",
        ciphertext,
        [],
        "user-1"
      );

      expect(result).toBe(plaintext);
    });

    it("should return syncing message when requesting key from sender", async () => {
      const { getIdentityKeys, getChannelKey } = await import("../../lib/keyStore");
      const { api } = await import("../../lib/api");
      const { wsClient } = await import("../../lib/websocket");
      const { decryptChannelMessage } = await import("../../lib/channelCrypto");

      const userKeyPair = await generateKeyPair();
      const userPublicKey = await exportPublicKey(userKeyPair.publicKey);
      const userPrivateKey = await exportPrivateKey(userKeyPair.privateKey);

      vi.mocked(getIdentityKeys).mockResolvedValue({
        userId: "user-1",
        identityKeyPair: {
          publicKey: userPublicKey,
          privateKey: userPrivateKey,
        },
        signedPreKeyPair: {
          publicKey: "signed-pub",
          privateKey: "signed-priv",
        },
      });
      vi.mocked(getChannelKey).mockResolvedValue(null);
      vi.mocked(api.channels.getSenderKeys).mockResolvedValue({ senderKeys: [] });

      const result = await decryptChannelMessage(
        "channel-123",
        "invalid-ciphertext",
        [],
        "user-1",
        "sender-1" // senderId provided
      );

      expect(result).toBe("[Syncing keys...]");
      expect(wsClient.requestKey).toHaveBeenCalledWith("channel-123", "sender-1");
    });

    it("should return unable to decrypt when no key available and no sender", async () => {
      const { getIdentityKeys, getChannelKey } = await import("../../lib/keyStore");
      const { api } = await import("../../lib/api");
      const { decryptChannelMessage } = await import("../../lib/channelCrypto");

      const userKeyPair = await generateKeyPair();
      const userPublicKey = await exportPublicKey(userKeyPair.publicKey);
      const userPrivateKey = await exportPrivateKey(userKeyPair.privateKey);

      vi.mocked(getIdentityKeys).mockResolvedValue({
        userId: "user-1",
        identityKeyPair: {
          publicKey: userPublicKey,
          privateKey: userPrivateKey,
        },
        signedPreKeyPair: {
          publicKey: "signed-pub",
          privateKey: "signed-priv",
        },
      });
      vi.mocked(getChannelKey).mockResolvedValue(null);
      vi.mocked(api.channels.getSenderKeys).mockResolvedValue({ senderKeys: [] });
      vi.mocked(api.channels.getSenderKeyOwners).mockResolvedValue({
        senderKeyOwners: [],
      });

      const result = await decryptChannelMessage(
        "channel-123",
        "invalid-ciphertext",
        [],
        "user-1"
        // No senderId
      );

      expect(result).toBe("[Unable to decrypt message]");
    });
  });

  describe("tryFetchChannelKey", () => {
    it("should return false if key already exists locally", async () => {
      const { hasChannelKey } = await import("../../lib/keyStore");
      const { tryFetchChannelKey } = await import("../../lib/channelCrypto");

      vi.mocked(hasChannelKey).mockResolvedValue(true);

      const result = await tryFetchChannelKey("channel-123", "user-1");

      expect(result).toBe(false);
    });

    it("should return false if no identity keys", async () => {
      const { hasChannelKey, getIdentityKeys } = await import("../../lib/keyStore");
      const { tryFetchChannelKey } = await import("../../lib/channelCrypto");

      vi.mocked(hasChannelKey).mockResolvedValue(false);
      vi.mocked(getIdentityKeys).mockResolvedValue(null);

      const result = await tryFetchChannelKey("channel-123", "user-1");

      expect(result).toBe(false);
    });

    it("should fetch and store key from server successfully", async () => {
      const {
        hasChannelKey,
        getIdentityKeys,
        storeChannelKey,
        getUserKey,
        storeUserKey,
      } = await import("../../lib/keyStore");
      const { api } = await import("../../lib/api");
      const { tryFetchChannelKey } = await import("../../lib/channelCrypto");

      // Generate real keys
      const senderKeyPair = await generateKeyPair();
      const recipientKeyPair = await generateKeyPair();
      const channelKey = await generateChannelKey();

      const { encryptChannelKeyForRecipient } = await import("../../lib/crypto");
      const senderPublicKey = await exportPublicKey(senderKeyPair.publicKey);
      const recipientPublicKey = await exportPublicKey(recipientKeyPair.publicKey);
      const recipientPrivateKey = await exportPrivateKey(recipientKeyPair.privateKey);

      const encryptedKey = await encryptChannelKeyForRecipient(
        channelKey,
        senderKeyPair.privateKey,
        recipientPublicKey
      );

      vi.mocked(hasChannelKey).mockResolvedValue(false);
      vi.mocked(getIdentityKeys).mockResolvedValue({
        userId: "user-1",
        identityKeyPair: {
          publicKey: recipientPublicKey,
          privateKey: recipientPrivateKey,
        },
        signedPreKeyPair: {
          publicKey: "signed-pub",
          privateKey: "signed-priv",
        },
      });
      vi.mocked(getUserKey).mockResolvedValue(null);
      vi.mocked(storeUserKey).mockResolvedValue(undefined);
      vi.mocked(storeChannelKey).mockResolvedValue(undefined);

      vi.mocked(api.channels.getSenderKeys).mockResolvedValue({
        senderKeys: [
          {
            userId: "sender-1",
            distributionId: "dist-1",
            encryptedKey: encryptedKey,
            senderPublicKey: senderPublicKey,
          },
        ],
      });

      const result = await tryFetchChannelKey("channel-123", "user-1");

      expect(result).toBe(true);
      expect(storeChannelKey).toHaveBeenCalled();
    });
  });

  describe("clearPendingKeyRequest", () => {
    it("should clear pending request for channel and user", async () => {
      const { clearPendingKeyRequest } = await import("../../lib/channelCrypto");

      // This should not throw
      clearPendingKeyRequest("channel-123", "user-1");
    });
  });

  describe("isDecryptionError", () => {
    it("should return true for known error strings", async () => {
      const { isDecryptionError } = await import("../../lib/channelCrypto");

      expect(isDecryptionError("[Syncing keys...]")).toBe(true);
      expect(isDecryptionError("[Unable to decrypt message]")).toBe(true);
      expect(isDecryptionError("[Encryption not set up - please re-register]")).toBe(true);
    });

    it("should return false for normal text", async () => {
      const { isDecryptionError } = await import("../../lib/channelCrypto");

      expect(isDecryptionError("Hello world")).toBe(false);
      expect(isDecryptionError("")).toBe(false);
      expect(isDecryptionError(undefined)).toBe(false);
    });
  });

  describe("ensureChannelKey deadlock recovery", () => {
    it("should create new key when sender keys exist but decryption fails (deadlock recovery)", async () => {
      const {
        getChannelKey,
        getIdentityKeys,
        storeChannelKey,
        storeUserKey,
        getUserKey,
      } = await import("../../lib/keyStore");
      const { api } = await import("../../lib/api");
      const { ensureChannelKey } = await import("../../lib/channelCrypto");

      const userKeyPair = await generateKeyPair();
      const userPublicKey = await exportPublicKey(userKeyPair.publicKey);
      const userPrivateKey = await exportPrivateKey(userKeyPair.privateKey);

      vi.mocked(getChannelKey).mockResolvedValue(null);
      vi.mocked(getIdentityKeys).mockResolvedValue({
        userId: "user-1",
        identityKeyPair: {
          publicKey: userPublicKey,
          privateKey: userPrivateKey,
        },
        signedPreKeyPair: {
          publicKey: "signed-pub",
          privateKey: "signed-priv",
        },
      });
      vi.mocked(getUserKey).mockResolvedValue(null);
      vi.mocked(storeUserKey).mockResolvedValue(undefined);
      vi.mocked(storeChannelKey).mockResolvedValue(undefined);

      // Sender keys exist but are cryptographically broken (decryption will fail)
      vi.mocked(api.channels.getSenderKeys).mockResolvedValue({
        senderKeys: [
          {
            userId: "sender-1",
            distributionId: "dist-1",
            encryptedKey: "broken-encrypted-key-data",
            senderPublicKey: userPublicKey, // Wrong key - will cause decryption failure
          },
        ],
      });

      // Key owners exist in the channel
      vi.mocked(api.channels.getSenderKeyOwners).mockResolvedValue({
        senderKeyOwners: [{ userId: "sender-1", senderPublicKey: userPublicKey }],
      });

      // Mock key distribution
      vi.mocked(api.channels.getMembers).mockResolvedValue({
        members: [{ id: "user-1", displayName: "User 1" }],
      });
      vi.mocked(api.auth.getUserKeys).mockResolvedValue({
        identityKey: userPublicKey,
        signedPreKey: { publicKey: "signed-pub", signature: "sig" },
        preKey: null,
      });
      vi.mocked(api.channels.distributeSenderKey).mockResolvedValue({
        success: true,
      });

      // createIfMissing=true (sending mode) - should create new key despite owners existing
      const result = await ensureChannelKey(
        "channel-123",
        [{ id: "user-1", displayName: "User 1" }],
        "user-1",
        true
      );

      expect(result.key).toBeDefined();
      expect(result.isNew).toBe(true);
      expect(storeChannelKey).toHaveBeenCalled();
      expect(api.channels.distributeSenderKey).toHaveBeenCalled();
    });

    it("should still throw syncing error when no sender keys exist for user but key owners exist", async () => {
      const { getChannelKey, getIdentityKeys } = await import("../../lib/keyStore");
      const { api } = await import("../../lib/api");
      const { wsClient } = await import("../../lib/websocket");
      const { ensureChannelKey } = await import("../../lib/channelCrypto");

      const userKeyPair = await generateKeyPair();
      const userPublicKey = await exportPublicKey(userKeyPair.publicKey);
      const userPrivateKey = await exportPrivateKey(userKeyPair.privateKey);

      vi.mocked(getChannelKey).mockResolvedValue(null);
      vi.mocked(getIdentityKeys).mockResolvedValue({
        userId: "user-1",
        identityKeyPair: {
          publicKey: userPublicKey,
          privateKey: userPrivateKey,
        },
        signedPreKeyPair: {
          publicKey: "signed-pub",
          privateKey: "signed-priv",
        },
      });

      // No sender keys for this user (empty array - no decryption attempted)
      vi.mocked(api.channels.getSenderKeys).mockResolvedValue({ senderKeys: [] });

      // But key owners exist
      vi.mocked(api.channels.getSenderKeyOwners).mockResolvedValue({
        senderKeyOwners: [{ userId: "owner-1", senderPublicKey: "owner-pub" }],
      });

      // Should still throw syncing error (anti-fragmentation preserved)
      await expect(
        ensureChannelKey("channel-123", [], "user-1", true)
      ).rejects.toThrow("Syncing channel key");

      expect(wsClient.requestKey).toHaveBeenCalledWith("channel-123", "owner-1");
    });

    it("should not create new key in receive mode even if decryption fails", async () => {
      const {
        getChannelKey,
        getIdentityKeys,
        getUserKey,
        storeUserKey,
      } = await import("../../lib/keyStore");
      const { api } = await import("../../lib/api");
      const { wsClient } = await import("../../lib/websocket");
      const { ensureChannelKey } = await import("../../lib/channelCrypto");

      const userKeyPair = await generateKeyPair();
      const userPublicKey = await exportPublicKey(userKeyPair.publicKey);
      const userPrivateKey = await exportPrivateKey(userKeyPair.privateKey);

      vi.mocked(getChannelKey).mockResolvedValue(null);
      vi.mocked(getIdentityKeys).mockResolvedValue({
        userId: "user-1",
        identityKeyPair: {
          publicKey: userPublicKey,
          privateKey: userPrivateKey,
        },
        signedPreKeyPair: {
          publicKey: "signed-pub",
          privateKey: "signed-priv",
        },
      });
      vi.mocked(getUserKey).mockResolvedValue(null);
      vi.mocked(storeUserKey).mockResolvedValue(undefined);

      // Sender keys exist but are broken
      vi.mocked(api.channels.getSenderKeys).mockResolvedValue({
        senderKeys: [
          {
            userId: "sender-1",
            distributionId: "dist-1",
            encryptedKey: "broken-encrypted-key-data",
            senderPublicKey: userPublicKey,
          },
        ],
      });

      // Key owners exist
      vi.mocked(api.channels.getSenderKeyOwners).mockResolvedValue({
        senderKeyOwners: [{ userId: "sender-1", senderPublicKey: userPublicKey }],
      });

      // createIfMissing=false (receive mode) - should NOT create new key, should throw
      await expect(
        ensureChannelKey("channel-123", [], "user-1", false)
      ).rejects.toThrow("Syncing keys...");

      expect(wsClient.requestKey).toHaveBeenCalled();
    });
  });

  describe("canEncryptInChannel", () => {
    it("should return true when channel key exists", async () => {
      const { hasChannelKey } = await import("../../lib/keyStore");
      const { canEncryptInChannel } = await import("../../lib/channelCrypto");

      vi.mocked(hasChannelKey).mockResolvedValue(true);

      const result = await canEncryptInChannel("channel-123");

      expect(result).toBe(true);
    });

    it("should return false when no channel key", async () => {
      const { hasChannelKey } = await import("../../lib/keyStore");
      const { canEncryptInChannel } = await import("../../lib/channelCrypto");

      vi.mocked(hasChannelKey).mockResolvedValue(false);

      const result = await canEncryptInChannel("channel-123");

      expect(result).toBe(false);
    });
  });
});
