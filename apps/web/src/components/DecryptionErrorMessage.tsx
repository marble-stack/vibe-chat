interface DecryptionErrorMessageProps {
  errorType?: string;
  onRetry?: () => void;
}

export function DecryptionErrorMessage({ errorType, onRetry }: DecryptionErrorMessageProps) {
  const isSyncing = errorType === "[Syncing keys...]";
  const isSetupRequired = errorType === "[Encryption not set up - please re-register]";

  // Choose message based on error type
  let message = "Unable to decrypt message";
  let subMessage = "";

  if (isSyncing) {
    message = "Syncing encryption keys...";
    subMessage = "Waiting for another member to share the key";
  } else if (isSetupRequired) {
    message = "Encryption not set up";
    subMessage = "Please re-register to enable encryption";
  } else {
    // Permanent decryption failure (likely key fragmentation)
    subMessage = "The encryption key for this message is unavailable";
  }

  return (
    <div
      data-testid="decryption-error-container"
      className={`text-sm flex items-center gap-2 ${isSyncing ? "text-yellow-400" : "text-red-400"}`}
    >
      {isSyncing ? (
        // Syncing animation
        <svg
          data-testid="decryption-syncing-icon"
          className="w-4 h-4 flex-shrink-0 animate-spin"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      ) : (
        // Error icon
        <svg
          data-testid="decryption-error-icon"
          className="w-4 h-4 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
          />
        </svg>
      )}
      <div className="flex flex-col">
        <span>{message}</span>
        {subMessage && <span className="text-xs text-text-muted">{subMessage}</span>}
      </div>
      {onRetry && !isSyncing && (
        <button
          onClick={onRetry}
          className="text-accent-primary hover:text-accent-primary/80 underline ml-1"
        >
          Retry
        </button>
      )}
    </div>
  );
}
