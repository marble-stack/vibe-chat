import { useState, useEffect } from "react";
import { useAuthStore } from "../stores/auth";
import { hasIdentityKeys, regenerateIdentityKeys } from "../lib/keyStore";
import { logger } from "../lib/logger";

export function KeyRecoveryBanner() {
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const [needsRecovery, setNeedsRecovery] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check for missing keys on mount and when user changes
  useEffect(() => {
    const checkKeys = async () => {
      if (!user) return;
      const hasKeys = await hasIdentityKeys();
      setNeedsRecovery(!hasKeys);
    };
    checkKeys();
  }, [user]);

  const handleRegenerate = async () => {
    if (!user || !token) return;

    setIsRegenerating(true);
    setError(null);

    try {
      const result = await regenerateIdentityKeys(user.id, token);
      if (result.success) {
        setNeedsRecovery(false);
        logger.info("Successfully regenerated encryption keys");
        // Reload the page to reinitialize encryption
        window.location.reload();
      } else {
        setError(result.error || "Failed to regenerate keys");
      }
    } catch (err) {
      logger.error("Key regeneration error:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsRegenerating(false);
    }
  };

  if (!needsRecovery) return null;

  return (
    <div className="bg-yellow-500/20 border-b border-yellow-500/50 px-4 py-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
        <div className="flex items-center gap-2 flex-1">
          <svg
            className="w-5 h-5 text-yellow-500 flex-shrink-0"
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
          <div>
            <p className="text-yellow-200 text-sm font-medium">
              Encryption keys missing
            </p>
            <p className="text-yellow-200/70 text-xs">
              Your local encryption keys were cleared. Regenerate them to send and receive messages.
              Note: Previous messages may be unreadable.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="text-red-400 text-xs">{error}</span>}
          <button
            onClick={handleRegenerate}
            disabled={isRegenerating}
            className="bg-yellow-500 hover:bg-yellow-600 disabled:bg-yellow-500/50 text-black font-medium px-4 py-1.5 rounded text-sm whitespace-nowrap transition-colors"
          >
            {isRegenerating ? "Regenerating..." : "Regenerate Keys"}
          </button>
        </div>
      </div>
    </div>
  );
}
