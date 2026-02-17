/**
 * E2E Encryption module using Web Crypto API
 *
 * Uses ECDH P-256 for key exchange and AES-GCM for message encryption.
 * Each channel has a shared symmetric key derived from member key exchanges.
 */

// Utility functions for encoding/decoding
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Key pair interface
export interface KeyPairData {
  publicKey: string; // Base64 encoded
  privateKey: string; // Base64 encoded (JWK format for storage)
}

export interface IdentityKeys {
  identityKeyPair: KeyPairData;
  signedPreKeyPair: KeyPairData;
  signedPreKeySignature: string;
  preKeyPairs: Array<{ keyId: number; keyPair: KeyPairData }>;
}

/**
 * Generate an ECDH key pair for key exchange
 */
export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveKey",
    "deriveBits",
  ]);
}

/**
 * Export a public key to base64 for transmission
 */
export async function exportPublicKey(publicKey: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey("spki", publicKey);
  return arrayBufferToBase64(exported);
}

/**
 * Export a private key to JWK for storage
 */
export async function exportPrivateKey(privateKey: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey("jwk", privateKey);
  return JSON.stringify(exported);
}

/**
 * Import a public key from base64
 */
export async function importPublicKey(publicKeyBase64: string): Promise<CryptoKey> {
  const keyData = base64ToArrayBuffer(publicKeyBase64);
  return await crypto.subtle.importKey(
    "spki",
    keyData,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    []
  );
}

/**
 * Import a private key from JWK string
 */
export async function importPrivateKey(privateKeyJwk: string): Promise<CryptoKey> {
  const jwk = JSON.parse(privateKeyJwk);
  return await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveKey",
    "deriveBits",
  ]);
}

/**
 * Derive a shared AES-GCM key from ECDH key exchange
 */
export async function deriveSharedKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey
): Promise<CryptoKey> {
  return await crypto.subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

/**
 * Generate a random channel key (for group encryption)
 */
export async function generateChannelKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Export an AES key to base64 for transmission
 */
export async function exportAesKey(key: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey("raw", key);
  return arrayBufferToBase64(exported);
}

/**
 * Import an AES key from base64
 */
export async function importAesKey(keyBase64: string): Promise<CryptoKey> {
  const keyData = base64ToArrayBuffer(keyBase64);
  return await crypto.subtle.importKey("raw", keyData, { name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypt a message with AES-GCM
 * Returns base64 encoded: iv (12 bytes) + ciphertext
 */
export async function encryptMessage(message: string, key: CryptoKey): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);

  // Generate random IV
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Encrypt
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);

  // Combine IV + ciphertext
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return arrayBufferToBase64(combined.buffer);
}

/**
 * Decrypt a message with AES-GCM
 * Expects base64 encoded: iv (12 bytes) + ciphertext
 */
export async function decryptMessage(ciphertextBase64: string, key: CryptoKey): Promise<string> {
  const combined = new Uint8Array(base64ToArrayBuffer(ciphertextBase64));

  // Extract IV and ciphertext
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  // Decrypt
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

/**
 * Sign data using ECDSA (for signed pre-key)
 */
export async function generateSigningKeyPair(): Promise<CryptoKeyPair> {
  return await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
}

/**
 * Sign data with private key
 */
export async function signData(data: ArrayBuffer, privateKey: CryptoKey): Promise<string> {
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, data);
  return arrayBufferToBase64(signature);
}

/**
 * Generate all identity keys for a new user
 */
export async function generateIdentityKeys(): Promise<{
  keys: IdentityKeys;
  publicBundle: {
    identityKeyPublic: string;
    signedPreKeyPublic: string;
    signedPreKeySignature: string;
    preKeys: Array<{ keyId: string; publicKey: string }>;
  };
}> {
  // Generate identity key pair
  const identityKeyPair = await generateKeyPair();
  const identityPublic = await exportPublicKey(identityKeyPair.publicKey);
  const identityPrivate = await exportPrivateKey(identityKeyPair.privateKey);

  // Generate signed pre-key pair
  const signedPreKeyPair = await generateKeyPair();
  const signedPreKeyPublic = await exportPublicKey(signedPreKeyPair.publicKey);
  const signedPreKeyPrivate = await exportPrivateKey(signedPreKeyPair.privateKey);

  // Sign the pre-key with identity key (we use ECDSA for signing)
  const signingKeyPair = await generateSigningKeyPair();
  const preKeyData = base64ToArrayBuffer(signedPreKeyPublic);
  const signature = await signData(preKeyData, signingKeyPair.privateKey);

  // Generate one-time pre-keys
  const preKeyPairs: Array<{ keyId: number; keyPair: KeyPairData }> = [];
  const preKeysPublic: Array<{ keyId: string; publicKey: string }> = [];

  for (let i = 0; i < 10; i++) {
    const preKeyPair = await generateKeyPair();
    const publicKey = await exportPublicKey(preKeyPair.publicKey);
    const privateKey = await exportPrivateKey(preKeyPair.privateKey);

    preKeyPairs.push({
      keyId: i,
      keyPair: { publicKey, privateKey },
    });

    preKeysPublic.push({
      keyId: String(i),
      publicKey,
    });
  }

  return {
    keys: {
      identityKeyPair: { publicKey: identityPublic, privateKey: identityPrivate },
      signedPreKeyPair: { publicKey: signedPreKeyPublic, privateKey: signedPreKeyPrivate },
      signedPreKeySignature: signature,
      preKeyPairs,
    },
    publicBundle: {
      identityKeyPublic: identityPublic,
      signedPreKeyPublic: signedPreKeyPublic,
      signedPreKeySignature: signature,
      preKeys: preKeysPublic,
    },
  };
}

/**
 * Derive a backup encryption key from a password using PBKDF2
 */
export async function deriveBackupKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 600000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt identity keys for server-side backup (password-derived)
 */
export async function encryptKeyBackup(
  keys: IdentityKeys,
  password: string,
  channelKeys?: Record<string, string>
): Promise<{ ciphertext: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const backupKey = await deriveBackupKey(password, salt);

  const payload = channelKeys ? { ...keys, channelKeys } : keys;
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    backupKey,
    plaintext
  );

  // Combine IV + ciphertext
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);

  return {
    ciphertext: arrayBufferToBase64(combined.buffer),
    salt: arrayBufferToBase64(salt.buffer),
  };
}

/**
 * Decrypt identity keys from server-side backup (password-derived)
 */
export async function decryptKeyBackup(
  ciphertextBase64: string,
  password: string,
  saltBase64: string
): Promise<IdentityKeys & { channelKeys?: Record<string, string> }> {
  const salt = new Uint8Array(base64ToArrayBuffer(saltBase64));
  const backupKey = await deriveBackupKey(password, salt);

  const combined = new Uint8Array(base64ToArrayBuffer(ciphertextBase64));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    backupKey,
    ciphertext
  );

  return JSON.parse(new TextDecoder().decode(decrypted)) as IdentityKeys & { channelKeys?: Record<string, string> };
}

/**
 * Upload key backup with retry logic (exponential backoff).
 * Retries up to 5 times: 1s, 2s, 4s, 8s, 16s delays.
 * Returns true if backup succeeded, false if all retries exhausted.
 */
export async function uploadKeyBackupWithRetry(
  keys: IdentityKeys,
  password: string,
  token: string,
  channelKeys?: Record<string, string>
): Promise<boolean> {
  const { api } = await import("./api");
  const maxRetries = 5;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const { ciphertext, salt } = await encryptKeyBackup(keys, password, channelKeys);
      await api.auth.uploadKeyBackup(
        { encryptedKeyBackup: ciphertext, salt },
        token
      );
      return true;
    } catch (err) {
      const delay = 1000 * Math.pow(2, attempt);
      console.warn(
        `Key backup attempt ${attempt + 1}/${maxRetries} failed, retrying in ${delay}ms:`,
        err
      );
      if (attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  return false;
}

/**
 * Encrypt a channel key for a recipient using their public key
 */
export async function encryptChannelKeyForRecipient(
  channelKey: CryptoKey,
  senderPrivateKey: CryptoKey,
  recipientPublicKeyBase64: string
): Promise<string> {
  // Import recipient's public key
  const recipientPublicKey = await importPublicKey(recipientPublicKeyBase64);

  // Derive shared secret
  const sharedKey = await deriveSharedKey(senderPrivateKey, recipientPublicKey);

  // Export and encrypt the channel key
  const channelKeyRaw = await exportAesKey(channelKey);
  return await encryptMessage(channelKeyRaw, sharedKey);
}

/**
 * Decrypt a channel key received from a sender
 */
export async function decryptChannelKey(
  encryptedChannelKey: string,
  recipientPrivateKey: CryptoKey,
  senderPublicKeyBase64: string
): Promise<CryptoKey> {
  // Import sender's public key
  const senderPublicKey = await importPublicKey(senderPublicKeyBase64);

  // Derive shared secret
  const sharedKey = await deriveSharedKey(recipientPrivateKey, senderPublicKey);

  // Decrypt the channel key
  const channelKeyBase64 = await decryptMessage(encryptedChannelKey, sharedKey);
  return await importAesKey(channelKeyBase64);
}
