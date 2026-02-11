import { useState } from "react";
import { useAuthStore } from "../stores/auth";
import { getIdentityKeys } from "../lib/keyStore";
import { uploadKeyBackupWithRetry } from "../lib/crypto";
import { logger } from "../lib/logger";

export function KeyBackupWarning() {
  const keyBackupStatus = useAuthStore((state) => state.keyBackupStatus);
  const token = useAuthStore((state) => state.token);
  const [retrying, setRetrying] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (keyBackupStatus !== "failed" || dismissed || !token) return null;

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const identityKeys = await getIdentityKeys();
      if (!identityKeys) {
        logger.error("No identity keys to back up");
        return;
      }

      // Prompt for password since we need it for encryption
      const password = window.prompt(
        "Enter your password to encrypt your key backup:"
      );
      if (!password) {
        setRetrying(false);
        return;
      }

      // Reconstruct IdentityKeys from stored data (preKeys aren't stored after registration)
      const keys = {
        identityKeyPair: identityKeys.identityKeyPair,
        signedPreKeyPair: {
          publicKey: identityKeys.signedPreKeyPair.publicKey,
          privateKey: identityKeys.signedPreKeyPair.privateKey,
        },
        signedPreKeySignature: "",
        preKeyPairs: [],
      };

      const success = await uploadKeyBackupWithRetry(keys, password, token);
      const { setKeyBackupStatus, setLastBackupAt } = useAuthStore.getState();
      if (success) {
        setKeyBackupStatus("success");
        setLastBackupAt(Date.now());
      }
    } catch (err) {
      logger.error("Retry key backup failed:", err);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="bg-orange-500/20 border-b border-orange-500/50 px-4 py-2">
      <div className="flex items-center gap-3">
        <svg
          className="w-4 h-4 text-orange-400 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <span className="text-orange-200 text-sm flex-1">
          Key backup failed. Your encryption keys aren't backed up to the server.
        </span>
        <button
          onClick={handleRetry}
          disabled={retrying}
          className="bg-orange-500 hover:bg-orange-600 disabled:bg-orange-500/50 text-black font-medium px-3 py-1 rounded text-xs whitespace-nowrap transition-colors"
        >
          {retrying ? "Retrying..." : "Retry Backup"}
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="text-orange-300/60 hover:text-orange-200 text-xs"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
