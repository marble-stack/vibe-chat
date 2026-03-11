/**
 * Key Backup Sync — automatically re-uploads the key backup when channel keys change.
 *
 * This ensures the server-side backup always includes the latest channel keys,
 * so device switching restores them without relying on online key holders.
 */

import { useAuthStore } from "../stores/auth";
import { onChannelKeyChange, getAllChannelKeys, getFullIdentityKeysForBackup } from "./keyStore";
import { uploadKeyBackupWithRetry } from "./crypto";
import { logger } from "./logger";

let cleanupFn: (() => void) | null = null;

/**
 * Initialize automatic backup re-upload on channel key changes.
 * Returns a cleanup function to unsubscribe.
 */
export function initKeyBackupSync(): () => void {
  // Prevent double-init
  if (cleanupFn) {
    cleanupFn();
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let uploading = false;

  const triggerReupload = async () => {
    if (uploading) return;

    const { sessionPassword, token } = useAuthStore.getState();
    if (!sessionPassword || !token) return;

    uploading = true;
    try {
      const fullKeys = await getFullIdentityKeysForBackup();
      const channelKeys = await getAllChannelKeys();
      if (fullKeys && Object.keys(channelKeys).length > 0) {
        const success = await uploadKeyBackupWithRetry(fullKeys, sessionPassword, token, channelKeys);
        if (success) {
          logger.debug("Key backup re-uploaded with updated channel keys");
        }
      }
    } catch (err) {
      logger.error("Key backup sync failed:", err);
    } finally {
      uploading = false;
    }
  };

  const debouncedReupload = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(triggerReupload, 3000);
  };

  const unsubscribe = onChannelKeyChange(debouncedReupload);

  cleanupFn = () => {
    unsubscribe();
    if (debounceTimer) clearTimeout(debounceTimer);
    cleanupFn = null;
  };

  return cleanupFn;
}

/**
 * Clean up the key backup sync listener.
 */
export function cleanupKeyBackupSync(): void {
  if (cleanupFn) {
    cleanupFn();
  }
}
