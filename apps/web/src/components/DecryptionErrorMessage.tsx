interface DecryptionErrorMessageProps {
  onRetry?: () => void;
}

export function DecryptionErrorMessage({ onRetry }: DecryptionErrorMessageProps) {
  return (
    <div
      data-testid="decryption-error-container"
      className="text-red-400 text-sm flex items-center gap-2"
    >
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
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
      <span>Failed to decrypt message</span>
      {onRetry && (
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
