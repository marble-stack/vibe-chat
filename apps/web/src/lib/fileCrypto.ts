/**
 * File encryption/decryption using AES-GCM (same as message encryption).
 * Files are encrypted client-side before upload and decrypted after download.
 */

import { arrayBufferToBase64, base64ToArrayBuffer } from "./crypto";

/**
 * Encrypt a file with the channel's AES-GCM key.
 * Returns the encrypted blob and the IV used (base64).
 */
export async function encryptFile(
  file: File,
  channelKey: CryptoKey
): Promise<{ encryptedBlob: Blob; iv: string }> {
  const fileData = await file.arrayBuffer();
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    channelKey,
    fileData
  );

  return {
    encryptedBlob: new Blob([encrypted]),
    iv: arrayBufferToBase64(iv.buffer),
  };
}

/**
 * Decrypt a file blob with the channel's AES-GCM key and IV.
 * Returns the decrypted Blob.
 */
export async function decryptFile(
  encryptedBlob: Blob,
  ivBase64: string,
  channelKey: CryptoKey
): Promise<Blob> {
  const iv = new Uint8Array(base64ToArrayBuffer(ivBase64));
  const encryptedData = await encryptedBlob.arrayBuffer();

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    channelKey,
    encryptedData
  );

  return new Blob([decrypted]);
}
