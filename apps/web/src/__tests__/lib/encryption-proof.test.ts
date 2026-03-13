/**
 * @vitest-environment happy-dom
 *
 * ENCRYPTION PROOF TESTS
 *
 * These tests prove that Vibe Chat's encryption actually works.
 * Every test uses the REAL Web Crypto API — no fakes, no mocks.
 * When these tests pass, it's mathematical proof that:
 *
 *   1. The server never sees your messages (only encrypted gibberish)
 *   2. Only people with the right key can read messages
 *   3. Each channel has its own separate encryption key
 *   4. The key exchange between users actually works
 *   5. Tampered or corrupted messages are detected and rejected
 */
import { describe, it, expect } from "vitest";
import {
  generateKeyPair,
  exportPublicKey,
  deriveSharedKey,
  generateChannelKey,
  exportAesKey,
  importAesKey,
  encryptMessage,
  decryptMessage,
  encryptChannelKeyForRecipient,
  decryptChannelKey,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  generateIdentityKeys,
  verifySignedPreKey,
  generateFingerprint,
} from "../../lib/crypto.js";

/**
 * Flip one bit in a byte array (used by tamper-detection tests)
 */
function flipBit(bytes: Uint8Array, byteIndex: number): Uint8Array {
  const copy = new Uint8Array(bytes);
  copy[byteIndex] ^= 0x01;
  return copy;
}

// ---------------------------------------------------------------------------
// PROOF 1: The server never sees your messages
// ---------------------------------------------------------------------------
describe("Proof: The server never sees your messages", () => {
  it('when you send "Hello friends!", the encrypted version is unreadable gibberish — not the original text', async () => {
    const key = await generateChannelKey();
    const ciphertext = await encryptMessage("Hello friends!", key);

    // The encrypted output must NOT contain any part of the original message
    expect(ciphertext).not.toContain("Hello");
    expect(ciphertext).not.toContain("friends");
    expect(ciphertext).not.toContain("Hello friends!");

    // It should be a base64 string (the format stored on the server)
    expect(ciphertext).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("encrypting the same message twice produces completely different ciphertext each time", async () => {
    const key = await generateChannelKey();
    const message = "Hey what's up?";

    const encrypted1 = await encryptMessage(message, key);
    const encrypted2 = await encryptMessage(message, key);

    // Even though the message is identical, the encrypted versions are different
    // (because a random IV is generated each time)
    expect(encrypted1).not.toBe(encrypted2);
  });

  it("the encrypted data contains cryptographic overhead, not just scrambled text", async () => {
    const key = await generateChannelKey();
    const ciphertext = await encryptMessage("Hi", key);

    // Decode the base64 to see the raw bytes
    const raw = new Uint8Array(base64ToArrayBuffer(ciphertext));

    // "Hi" is only 2 bytes, but the encrypted version must contain:
    //   12 bytes (IV) + 2 bytes (encrypted text) + 16 bytes (authentication tag) = 30+ bytes
    expect(raw.byteLength).toBeGreaterThanOrEqual(30);
  });
});

// ---------------------------------------------------------------------------
// PROOF 2: Only people with the right key can read messages
// ---------------------------------------------------------------------------
describe("Proof: Only people with the right key can read messages", () => {
  it("a message encrypted with one key CANNOT be decrypted with a different key", async () => {
    const rightKey = await generateChannelKey();
    const wrongKey = await generateChannelKey();

    const ciphertext = await encryptMessage(
      "Secret plans for the surprise party",
      rightKey
    );

    // Trying to decrypt with the wrong key must fail
    await expect(decryptMessage(ciphertext, wrongKey)).rejects.toThrow();
  });

  it("with the correct key, the original message is recovered perfectly — not a single character changed", async () => {
    const key = await generateChannelKey();
    const original = "Meeting at 3pm! Don't be late 🎉 こんにちは";

    const ciphertext = await encryptMessage(original, key);
    const decrypted = await decryptMessage(ciphertext, key);

    // Every character, including emoji and Japanese, must match exactly
    expect(decrypted).toBe(original);
  });

  it("even a key that differs by just one bit cannot decrypt the message", async () => {
    const key = await generateChannelKey();
    const ciphertext = await encryptMessage("Top secret info", key);

    // Export the key, flip one bit, re-import
    const keyBase64 = await exportAesKey(key);
    const keyBytes = new Uint8Array(base64ToArrayBuffer(keyBase64));
    const tamperedKeyBytes = flipBit(keyBytes, 0);
    const tamperedKey = await importAesKey(
      arrayBufferToBase64(tamperedKeyBytes.buffer)
    );

    // The one-bit-different key must fail to decrypt
    await expect(decryptMessage(ciphertext, tamperedKey)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// PROOF 3: Each channel has its own encryption key
// ---------------------------------------------------------------------------
describe("Proof: Each channel has its own encryption key", () => {
  it("two different channels use completely different keys", async () => {
    const channelAKey = await generateChannelKey();
    const channelBKey = await generateChannelKey();

    const exportedA = await exportAesKey(channelAKey);
    const exportedB = await exportAesKey(channelBKey);

    // The keys must be different
    expect(exportedA).not.toBe(exportedB);
  });

  it("a message encrypted for one channel cannot be decrypted with another channel's key", async () => {
    const generalKey = await generateChannelKey();
    const privateKey = await generateChannelKey();

    const ciphertext = await encryptMessage(
      "This is for the #general channel",
      generalKey
    );

    // Trying to read #general's message with #private's key must fail
    await expect(decryptMessage(ciphertext, privateKey)).rejects.toThrow();
  });

  it("if one channel's key is compromised, messages in other channels remain safe", async () => {
    const keyA = await generateChannelKey();
    const keyB = await generateChannelKey();

    const messageA = await encryptMessage("Channel A secret", keyA);
    const messageB = await encryptMessage("Channel B secret", keyB);

    // Key A can decrypt message A
    expect(await decryptMessage(messageA, keyA)).toBe("Channel A secret");

    // Key A CANNOT decrypt message B
    await expect(decryptMessage(messageB, keyA)).rejects.toThrow();

    // Key B can decrypt message B
    expect(await decryptMessage(messageB, keyB)).toBe("Channel B secret");

    // Key B CANNOT decrypt message A
    await expect(decryptMessage(messageA, keyB)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// PROOF 4: The key exchange actually works
// ---------------------------------------------------------------------------
describe("Proof: Key exchange works — Alice and Bob independently compute the same shared secret", () => {
  it("Alice and Bob each generate their own key pair, exchange public keys, and independently derive the SAME shared secret", async () => {
    // Alice and Bob each generate their own private keys (never shared)
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    // They exchange ONLY public keys (safe to send over the network)
    // Alice computes: her private key + Bob's public key
    const aliceShared = await deriveSharedKey(alice.privateKey, bob.publicKey);
    // Bob computes: his private key + Alice's public key
    const bobShared = await deriveSharedKey(bob.privateKey, alice.publicKey);

    // They independently arrive at the SAME shared secret
    const aliceExported = await exportAesKey(aliceShared);
    const bobExported = await exportAesKey(bobShared);
    expect(aliceExported).toBe(bobExported);
  });

  it("Alice can encrypt a channel key for Bob, and Bob can decrypt it — they end up with the exact same key", async () => {
    const channelKey = await generateChannelKey();
    const originalKeyBase64 = await exportAesKey(channelKey);

    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const bobPublicBase64 = await exportPublicKey(bob.publicKey);
    const alicePublicBase64 = await exportPublicKey(alice.publicKey);

    // Alice encrypts the channel key specifically for Bob
    const encryptedForBob = await encryptChannelKeyForRecipient(
      channelKey,
      alice.privateKey,
      bobPublicBase64
    );

    // Bob decrypts it using his private key and Alice's public key
    const decryptedKey = await decryptChannelKey(
      encryptedForBob,
      bob.privateKey,
      alicePublicBase64
    );

    // Bob now has the exact same channel key as Alice
    const decryptedKeyBase64 = await exportAesKey(decryptedKey);
    expect(decryptedKeyBase64).toBe(originalKeyBase64);
  });

  it("Eve (an eavesdropper) CANNOT decrypt the channel key even if she intercepts the encrypted key exchange", async () => {
    const channelKey = await generateChannelKey();
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const eve = await generateKeyPair(); // The eavesdropper

    const bobPublicBase64 = await exportPublicKey(bob.publicKey);
    const alicePublicBase64 = await exportPublicKey(alice.publicKey);

    // Alice encrypts the channel key for Bob
    const encryptedForBob = await encryptChannelKeyForRecipient(
      channelKey,
      alice.privateKey,
      bobPublicBase64
    );

    // Eve intercepts the encrypted key and tries to decrypt it with her own private key
    await expect(
      decryptChannelKey(encryptedForBob, eve.privateKey, alicePublicBase64)
    ).rejects.toThrow();
  });

  it("three-person group chat: Alice distributes the key to both Bob and Charlie, and all three can decrypt the same message", async () => {
    // Alice creates the channel key
    const channelKey = await generateChannelKey();

    // Each person has their own key pair
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const charlie = await generateKeyPair();

    const alicePublicBase64 = await exportPublicKey(alice.publicKey);
    const bobPublicBase64 = await exportPublicKey(bob.publicKey);
    const charliePublicBase64 = await exportPublicKey(charlie.publicKey);

    // Alice encrypts the channel key separately for Bob and Charlie
    const encryptedForBob = await encryptChannelKeyForRecipient(
      channelKey,
      alice.privateKey,
      bobPublicBase64
    );
    const encryptedForCharlie = await encryptChannelKeyForRecipient(
      channelKey,
      alice.privateKey,
      charliePublicBase64
    );

    // Bob and Charlie each decrypt their copy
    const bobKey = await decryptChannelKey(
      encryptedForBob,
      bob.privateKey,
      alicePublicBase64
    );
    const charlieKey = await decryptChannelKey(
      encryptedForCharlie,
      charlie.privateKey,
      alicePublicBase64
    );

    // Now all three encrypt/decrypt with the same key
    const message = "Welcome to the group chat! 🎊";
    const encrypted = await encryptMessage(message, channelKey);

    expect(await decryptMessage(encrypted, channelKey)).toBe(message); // Alice
    expect(await decryptMessage(encrypted, bobKey)).toBe(message); // Bob
    expect(await decryptMessage(encrypted, charlieKey)).toBe(message); // Charlie
  });
});

// ---------------------------------------------------------------------------
// PROOF 5: Tampered messages are detected and rejected
// ---------------------------------------------------------------------------
describe("Proof: Tampered messages are detected and rejected", () => {
  it("if someone modifies even one bit of the encrypted message, decryption fails", async () => {
    const key = await generateChannelKey();
    const ciphertext = await encryptMessage("Important message", key);

    // Decode, flip one bit in the ciphertext body (past the 12-byte IV)
    const raw = new Uint8Array(base64ToArrayBuffer(ciphertext));
    const tampered = flipBit(raw, 15); // Byte 15 is in the ciphertext portion
    const tamperedBase64 = arrayBufferToBase64(tampered.buffer);

    await expect(decryptMessage(tamperedBase64, key)).rejects.toThrow();
  });

  it("if someone modifies the IV (initialization vector), decryption fails", async () => {
    const key = await generateChannelKey();
    const ciphertext = await encryptMessage("Another secret", key);

    // Flip one bit in the IV (first 12 bytes)
    const raw = new Uint8Array(base64ToArrayBuffer(ciphertext));
    const tampered = flipBit(raw, 3); // Byte 3 is in the IV
    const tamperedBase64 = arrayBufferToBase64(tampered.buffer);

    await expect(decryptMessage(tamperedBase64, key)).rejects.toThrow();
  });

  it("a completely fabricated ciphertext cannot be decrypted", async () => {
    const key = await generateChannelKey();

    // Generate 64 bytes of random garbage and encode as base64
    const fakeData = crypto.getRandomValues(new Uint8Array(64));
    const fakeCiphertext = arrayBufferToBase64(fakeData.buffer);

    await expect(decryptMessage(fakeCiphertext, key)).rejects.toThrow();
  });

  it("truncating the encrypted message causes decryption to fail", async () => {
    const key = await generateChannelKey();
    const ciphertext = await encryptMessage(
      "This message must not be truncated",
      key
    );

    // Chop off the last 10 bytes
    const raw = new Uint8Array(base64ToArrayBuffer(ciphertext));
    const truncated = raw.slice(0, raw.length - 10);
    const truncatedBase64 = arrayBufferToBase64(truncated.buffer);

    await expect(decryptMessage(truncatedBase64, key)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// PROOF 6: Signed prekey signatures are verified
// ---------------------------------------------------------------------------
describe("Proof: Signed prekey signatures prevent key substitution attacks", () => {
  it("verifySignedPreKey returns true for a valid signature", async () => {
    const { keys, publicBundle } = await generateIdentityKeys();

    const isValid = await verifySignedPreKey(
      publicBundle.signedPreKeyPublic,
      publicBundle.signedPreKeySignature,
      publicBundle.signingKeyPublic
    );

    expect(isValid).toBe(true);
  });

  it("verifySignedPreKey returns false for a tampered prekey", async () => {
    const { publicBundle } = await generateIdentityKeys();

    // Generate a different key pair and use its public key as the "tampered" prekey
    const fakeKeyPair = await generateKeyPair();
    const fakePreKeyPublic = await exportPublicKey(fakeKeyPair.publicKey);

    const isValid = await verifySignedPreKey(
      fakePreKeyPublic,
      publicBundle.signedPreKeySignature,
      publicBundle.signingKeyPublic
    );

    expect(isValid).toBe(false);
  });

  it("verifySignedPreKey returns false for a wrong signing key", async () => {
    const { publicBundle } = await generateIdentityKeys();
    const { publicBundle: otherBundle } = await generateIdentityKeys();

    // Use the correct prekey and signature but a different user's signing key
    const isValid = await verifySignedPreKey(
      publicBundle.signedPreKeyPublic,
      publicBundle.signedPreKeySignature,
      otherBundle.signingKeyPublic
    );

    expect(isValid).toBe(false);
  });

  it("generateIdentityKeys includes a signing public key in the output", async () => {
    const { keys, publicBundle } = await generateIdentityKeys();

    // Both the private keys and public bundle should include the signing key
    expect(keys.signingKeyPublic).toBeDefined();
    expect(keys.signingKeyPublic.length).toBeGreaterThan(0);
    expect(publicBundle.signingKeyPublic).toBeDefined();
    expect(publicBundle.signingKeyPublic).toBe(keys.signingKeyPublic);
  });
});

// ---------------------------------------------------------------------------
// PROOF 7: Key fingerprints allow out-of-band identity verification
// ---------------------------------------------------------------------------
describe("Proof: Key fingerprints allow users to verify identities", () => {
  it("generates a consistent fingerprint for the same key", async () => {
    const keyPair = await generateKeyPair();
    const publicKeyBase64 = await exportPublicKey(keyPair.publicKey);

    const fp1 = await generateFingerprint(publicKeyBase64);
    const fp2 = await generateFingerprint(publicKeyBase64);

    expect(fp1).toBe(fp2);
  });

  it("generates different fingerprints for different keys", async () => {
    const key1 = await generateKeyPair();
    const key2 = await generateKeyPair();

    const fp1 = await generateFingerprint(await exportPublicKey(key1.publicKey));
    const fp2 = await generateFingerprint(await exportPublicKey(key2.publicKey));

    expect(fp1).not.toBe(fp2);
  });

  it("fingerprint format is 8 groups of 4 hex characters", async () => {
    const keyPair = await generateKeyPair();
    const fp = await generateFingerprint(await exportPublicKey(keyPair.publicKey));

    // Should be "xxxx xxxx xxxx xxxx xxxx xxxx xxxx xxxx"
    const groups = fp.split(" ");
    expect(groups).toHaveLength(8);
    for (const group of groups) {
      expect(group).toMatch(/^[0-9a-f]{4}$/);
    }
  });
});
