/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  generateKeyPair,
  exportPublicKey,
  exportPrivateKey,
  importPublicKey,
  importPrivateKey,
  deriveSharedKey,
  generateChannelKey,
  exportAesKey,
  importAesKey,
  encryptMessage,
  decryptMessage,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  encryptChannelKeyForRecipient,
  decryptChannelKey,
} from "../../lib/crypto.js";

describe("Crypto Module", () => {
  // Check if Web Crypto API is available
  beforeAll(() => {
    if (typeof crypto === "undefined" || !crypto.subtle) {
      console.warn("Web Crypto API not available, some tests may be skipped");
    }
  });

  describe("Base64 Encoding/Decoding", () => {
    it("should encode ArrayBuffer to base64", () => {
      const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const base64 = arrayBufferToBase64(data.buffer);
      expect(base64).toBe("SGVsbG8=");
    });

    it("should decode base64 to ArrayBuffer", () => {
      const base64 = "SGVsbG8=";
      const buffer = base64ToArrayBuffer(base64);
      const data = new Uint8Array(buffer);
      expect(Array.from(data)).toEqual([72, 101, 108, 108, 111]);
    });

    it("should round-trip encode/decode", () => {
      const original = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128]);
      const base64 = arrayBufferToBase64(original.buffer);
      const decoded = base64ToArrayBuffer(base64);
      expect(Array.from(new Uint8Array(decoded))).toEqual(Array.from(original));
    });
  });

  describe("Key Generation", () => {
    it("should generate valid ECDH P-256 key pairs", async () => {
      const keyPair = await generateKeyPair();

      expect(keyPair).toHaveProperty("publicKey");
      expect(keyPair).toHaveProperty("privateKey");

      // Verify key algorithm
      expect(keyPair.publicKey.algorithm.name).toBe("ECDH");
      expect(keyPair.privateKey.algorithm.name).toBe("ECDH");
    });

    it("should generate unique keys each call", async () => {
      const keyPair1 = await generateKeyPair();
      const keyPair2 = await generateKeyPair();

      const pub1 = await exportPublicKey(keyPair1.publicKey);
      const pub2 = await exportPublicKey(keyPair2.publicKey);

      // Public keys should be different
      expect(pub1).not.toBe(pub2);
    });

    it("should export and import public keys correctly", async () => {
      const keyPair = await generateKeyPair();

      const exported = await exportPublicKey(keyPair.publicKey);
      expect(typeof exported).toBe("string");
      expect(exported.length).toBeGreaterThan(0);

      const imported = await importPublicKey(exported);
      expect(imported.algorithm.name).toBe("ECDH");
    });

    it("should export and import private keys correctly", async () => {
      const keyPair = await generateKeyPair();

      const exported = await exportPrivateKey(keyPair.privateKey);
      expect(typeof exported).toBe("string");

      // Should be valid JSON (JWK format)
      const jwk = JSON.parse(exported);
      expect(jwk).toHaveProperty("kty", "EC");
      expect(jwk).toHaveProperty("crv", "P-256");

      const imported = await importPrivateKey(exported);
      expect(imported.algorithm.name).toBe("ECDH");
    });
  });

  describe("Key Exchange", () => {
    it("should derive same shared secret in both directions", async () => {
      // Alice's keys
      const aliceKeyPair = await generateKeyPair();
      // Bob's keys
      const bobKeyPair = await generateKeyPair();

      // Alice derives shared key using her private key and Bob's public key
      const aliceSharedKey = await deriveSharedKey(aliceKeyPair.privateKey, bobKeyPair.publicKey);

      // Bob derives shared key using his private key and Alice's public key
      const bobSharedKey = await deriveSharedKey(bobKeyPair.privateKey, aliceKeyPair.publicKey);

      // Export both keys to compare
      const aliceKeyExport = await exportAesKey(aliceSharedKey);
      const bobKeyExport = await exportAesKey(bobSharedKey);

      // Both should derive the same key
      expect(aliceKeyExport).toBe(bobKeyExport);
    });

    it("should derive different keys for different key pairs", async () => {
      const alice = await generateKeyPair();
      const bob = await generateKeyPair();
      const charlie = await generateKeyPair();

      // Alice-Bob shared key
      const aliceBobKey = await deriveSharedKey(alice.privateKey, bob.publicKey);
      // Alice-Charlie shared key
      const aliceCharlieKey = await deriveSharedKey(alice.privateKey, charlie.publicKey);

      const aliceBobExport = await exportAesKey(aliceBobKey);
      const aliceCharlieExport = await exportAesKey(aliceCharlieKey);

      // Different shared keys
      expect(aliceBobExport).not.toBe(aliceCharlieExport);
    });
  });

  describe("AES Key Management", () => {
    it("should generate channel keys", async () => {
      const key = await generateChannelKey();

      expect(key.algorithm.name).toBe("AES-GCM");
      expect((key.algorithm as AesKeyAlgorithm).length).toBe(256);
    });

    it("should export and import AES keys", async () => {
      const original = await generateChannelKey();
      const exported = await exportAesKey(original);
      const imported = await importAesKey(exported);

      expect(imported.algorithm.name).toBe("AES-GCM");

      // Verify the key works by encrypting/decrypting
      const testMessage = "test";
      const encrypted = await encryptMessage(testMessage, original);
      const decrypted = await decryptMessage(encrypted, imported);
      expect(decrypted).toBe(testMessage);
    });
  });

  describe("Encryption", () => {
    it("should encrypt and decrypt round-trip correctly", async () => {
      const key = await generateChannelKey();
      const originalMessage = "Hello, this is a secret message!";

      const ciphertext = await encryptMessage(originalMessage, key);
      const decrypted = await decryptMessage(ciphertext, key);

      expect(decrypted).toBe(originalMessage);
    });

    it("should handle empty strings", async () => {
      const key = await generateChannelKey();
      const originalMessage = "";

      const ciphertext = await encryptMessage(originalMessage, key);
      const decrypted = await decryptMessage(ciphertext, key);

      expect(decrypted).toBe(originalMessage);
    });

    it("should handle unicode characters", async () => {
      const key = await generateChannelKey();
      const originalMessage = "你好世界! 🎉 привет мир";

      const ciphertext = await encryptMessage(originalMessage, key);
      const decrypted = await decryptMessage(ciphertext, key);

      expect(decrypted).toBe(originalMessage);
    });

    it("should fail decryption with wrong key", async () => {
      const key1 = await generateChannelKey();
      const key2 = await generateChannelKey();
      const originalMessage = "Secret message";

      const ciphertext = await encryptMessage(originalMessage, key1);

      // Decrypting with wrong key should throw
      await expect(decryptMessage(ciphertext, key2)).rejects.toThrow();
    });

    it("should use unique IV per encryption", async () => {
      const key = await generateChannelKey();
      const message = "Same message";

      const ciphertext1 = await encryptMessage(message, key);
      const ciphertext2 = await encryptMessage(message, key);

      // Same message should produce different ciphertexts due to random IV
      expect(ciphertext1).not.toBe(ciphertext2);
    });

    it("should produce ciphertext with IV prefix", async () => {
      const key = await generateChannelKey();
      const message = "Test";

      const ciphertext = await encryptMessage(message, key);
      const combined = new Uint8Array(base64ToArrayBuffer(ciphertext));

      // IV is 12 bytes, so combined should be at least 12 bytes
      expect(combined.length).toBeGreaterThan(12);
    });
  });

  describe("Channel Key Distribution", () => {
    it("should encrypt channel key for recipient", async () => {
      const channelKey = await generateChannelKey();
      const sender = await generateKeyPair();
      const recipient = await generateKeyPair();

      const recipientPublicBase64 = await exportPublicKey(recipient.publicKey);
      const encrypted = await encryptChannelKeyForRecipient(
        channelKey,
        sender.privateKey,
        recipientPublicBase64
      );

      expect(typeof encrypted).toBe("string");
      expect(encrypted.length).toBeGreaterThan(0);
    });

    it("should decrypt channel key correctly", async () => {
      const channelKey = await generateChannelKey();
      const sender = await generateKeyPair();
      const recipient = await generateKeyPair();

      const recipientPublicBase64 = await exportPublicKey(recipient.publicKey);
      const senderPublicBase64 = await exportPublicKey(sender.publicKey);

      // Sender encrypts channel key for recipient
      const encrypted = await encryptChannelKeyForRecipient(
        channelKey,
        sender.privateKey,
        recipientPublicBase64
      );

      // Recipient decrypts channel key
      const decryptedChannelKey = await decryptChannelKey(
        encrypted,
        recipient.privateKey,
        senderPublicBase64
      );

      // Verify the decrypted key works
      const testMessage = "Test channel message";
      const ciphertext = await encryptMessage(testMessage, channelKey);
      const plaintext = await decryptMessage(ciphertext, decryptedChannelKey);

      expect(plaintext).toBe(testMessage);
    });

    it("should fail decryption with wrong sender public key", async () => {
      const channelKey = await generateChannelKey();
      const sender = await generateKeyPair();
      const recipient = await generateKeyPair();
      const wrongSender = await generateKeyPair();

      const recipientPublicBase64 = await exportPublicKey(recipient.publicKey);
      const wrongSenderPublicBase64 = await exportPublicKey(wrongSender.publicKey);

      // Sender encrypts channel key for recipient
      const encrypted = await encryptChannelKeyForRecipient(
        channelKey,
        sender.privateKey,
        recipientPublicBase64
      );

      // Recipient tries to decrypt with wrong sender public key - should fail
      await expect(
        decryptChannelKey(encrypted, recipient.privateKey, wrongSenderPublicBase64)
      ).rejects.toThrow();
    });
  });
});
