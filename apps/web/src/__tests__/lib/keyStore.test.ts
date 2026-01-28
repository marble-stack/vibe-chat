/**
 * @vitest-environment node
 *
 * KeyStore Tests
 *
 * Tests keyStore functionality using fake-indexeddb.
 * Uses unique IDs per test to avoid state conflicts.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

// Mock the crypto module
vi.mock("../../lib/crypto", () => ({
  importPrivateKey: vi.fn().mockResolvedValue({} as CryptoKey),
  importAesKey: vi.fn().mockResolvedValue({} as CryptoKey),
}));

// Generate unique IDs for each test run to avoid conflicts
const uniqueId = () => `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

describe("KeyStore Module", () => {
  // These will be populated by beforeAll
  let storeIdentityKeys: typeof import("../../lib/keyStore").storeIdentityKeys;
  let getIdentityKeys: typeof import("../../lib/keyStore").getIdentityKeys;
  let hasIdentityKeys: typeof import("../../lib/keyStore").hasIdentityKeys;
  let storeChannelKey: typeof import("../../lib/keyStore").storeChannelKey;
  let getChannelKey: typeof import("../../lib/keyStore").getChannelKey;
  let hasChannelKey: typeof import("../../lib/keyStore").hasChannelKey;
  let storeUserKey: typeof import("../../lib/keyStore").storeUserKey;
  let getUserKey: typeof import("../../lib/keyStore").getUserKey;
  let clearAllKeys: typeof import("../../lib/keyStore").clearAllKeys;

  beforeAll(async () => {
    // Set up fake IndexedDB globals BEFORE importing keyStore
    globalThis.indexedDB = new IDBFactory();
    globalThis.IDBKeyRange = IDBKeyRange;

    // Now import keyStore - it will use our fake IndexedDB
    const keyStore = await import("../../lib/keyStore");
    storeIdentityKeys = keyStore.storeIdentityKeys;
    getIdentityKeys = keyStore.getIdentityKeys;
    hasIdentityKeys = keyStore.hasIdentityKeys;
    storeChannelKey = keyStore.storeChannelKey;
    getChannelKey = keyStore.getChannelKey;
    hasChannelKey = keyStore.hasChannelKey;
    storeUserKey = keyStore.storeUserKey;
    getUserKey = keyStore.getUserKey;
    clearAllKeys = keyStore.clearAllKeys;
  });

  describe("Identity Keys", () => {
    it("should store and retrieve identity keys", async () => {
      const userId = uniqueId();
      const mockIdentityKeys = {
        identityKeyPair: {
          publicKey: "test-identity-public-key",
          privateKey: "test-identity-private-key",
        },
        signedPreKeyPair: {
          publicKey: "test-signed-prekey-public",
          privateKey: "test-signed-prekey-private",
        },
        signedPreKeySignature: "test-signature",
        preKeyPairs: [
          {
            keyId: 1,
            keyPair: {
              publicKey: "test-prekey-public-1",
              privateKey: "test-prekey-private-1",
            },
          },
        ],
      };

      await storeIdentityKeys(userId, mockIdentityKeys);

      const retrieved = await getIdentityKeys();
      expect(retrieved).not.toBeNull();
      expect(retrieved?.userId).toBe(userId);
      expect(retrieved?.identityKeyPair.publicKey).toBe("test-identity-public-key");
      expect(retrieved?.identityKeyPair.privateKey).toBe("test-identity-private-key");
      expect(retrieved?.signedPreKeyPair.publicKey).toBe("test-signed-prekey-public");
    });

    it("should return true for hasIdentityKeys after storing", async () => {
      const hasKeys = await hasIdentityKeys();
      expect(hasKeys).toBe(true);
    });
  });

  describe("Channel Keys", () => {
    it("should return false for hasChannelKey with non-existent channel", async () => {
      const nonExistentChannelId = uniqueId();
      const hasKey = await hasChannelKey(nonExistentChannelId);
      expect(hasKey).toBe(false);
    });

    it("should store and retrieve channel keys", async () => {
      const channelId = uniqueId();
      const keyBase64 = "test-channel-key-base64";

      await storeChannelKey(channelId, keyBase64);

      const key = await getChannelKey(channelId);
      expect(key).not.toBeNull();
    });

    it("should return true for hasChannelKey after storing", async () => {
      const channelId = uniqueId();
      await storeChannelKey(channelId, "test-key");

      const hasKey = await hasChannelKey(channelId);
      expect(hasKey).toBe(true);
    });

    it("should return null for non-existent channel key", async () => {
      const nonExistentChannelId = uniqueId();
      const key = await getChannelKey(nonExistentChannelId);
      expect(key).toBeNull();
    });
  });

  describe("User Keys", () => {
    it("should store and retrieve user keys", async () => {
      const userId = uniqueId();

      await storeUserKey(userId, "identity-public", "signed-prekey-public");

      const userKey = await getUserKey(userId);
      expect(userKey).not.toBeNull();
      expect(userKey?.userId).toBe(userId);
      expect(userKey?.identityKeyPublic).toBe("identity-public");
      expect(userKey?.signedPreKeyPublic).toBe("signed-prekey-public");
    });

    it("should return null for non-existent user key", async () => {
      const nonExistentUserId = uniqueId();
      const userKey = await getUserKey(nonExistentUserId);
      expect(userKey).toBeNull();
    });

    it("should update existing user key", async () => {
      const userId = uniqueId();

      // Store initial key
      await storeUserKey(userId, "old-identity", "old-prekey");

      // Update with new values
      await storeUserKey(userId, "new-identity", "new-prekey");

      const userKey = await getUserKey(userId);
      expect(userKey?.identityKeyPublic).toBe("new-identity");
      expect(userKey?.signedPreKeyPublic).toBe("new-prekey");
    });
  });

  describe("clearAllKeys", () => {
    it("should clear identity keys", async () => {
      // Store identity keys first (may already exist from previous tests)
      await storeIdentityKeys("clear-test-user", {
        identityKeyPair: { publicKey: "pub", privateKey: "priv" },
        signedPreKeyPair: { publicKey: "spub", privateKey: "spriv" },
        signedPreKeySignature: "sig",
        preKeyPairs: [],
      });

      // Verify stored
      expect(await hasIdentityKeys()).toBe(true);

      // Clear everything
      await clearAllKeys();

      // Verify identity cleared
      expect(await hasIdentityKeys()).toBe(false);
    });

    it("should clear channel keys", async () => {
      const channelId = uniqueId();

      // Store channel key
      await storeChannelKey(channelId, "test-key");
      expect(await hasChannelKey(channelId)).toBe(true);

      // Clear everything
      await clearAllKeys();

      // Verify channel key cleared
      expect(await hasChannelKey(channelId)).toBe(false);
    });

    it("should clear user keys", async () => {
      const userId = uniqueId();

      // Store user key
      await storeUserKey(userId, "ipub", "spub");
      expect(await getUserKey(userId)).not.toBeNull();

      // Clear everything
      await clearAllKeys();

      // Verify user key cleared
      expect(await getUserKey(userId)).toBeNull();
    });
  });
});
