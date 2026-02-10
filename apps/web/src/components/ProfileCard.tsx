import { useEffect, useRef } from "react";

interface ProfileCardProps {
  displayName: string;
  avatarUrl?: string;
  isOnline: boolean;
  position: { x: number; y: number };
  onClose: () => void;
}

export function ProfileCard({ displayName, avatarUrl, isOnline, position, onClose }: ProfileCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Adjust position to stay within viewport
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      card.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      card.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  }, []);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        ref={cardRef}
        className="fixed z-50 bg-background-secondary border border-background-tertiary rounded-lg shadow-xl w-64 overflow-hidden"
        style={{ left: position.x, top: position.y }}
      >
        {/* Banner */}
        <div className="h-16 bg-accent-primary" />

        {/* Avatar overlapping banner */}
        <div className="px-4 -mt-8">
          <div className="relative inline-block">
            <div className="w-16 h-16 rounded-full bg-accent-primary border-4 border-background-secondary flex items-center justify-center text-white text-2xl font-bold">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt=""
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                displayName.charAt(0).toUpperCase()
              )}
            </div>
            <div
              className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-[3px] border-background-secondary ${
                isOnline ? "bg-green-500" : "bg-gray-500"
              }`}
            />
          </div>
        </div>

        {/* Info */}
        <div className="p-4 pt-2">
          <h3 className="text-lg font-bold text-text-primary">{displayName}</h3>
          <div className="flex items-center gap-1.5 mt-1">
            <div
              className={`w-2 h-2 rounded-full ${isOnline ? "bg-green-500" : "bg-gray-500"}`}
            />
            <span className="text-sm text-text-muted">
              {isOnline ? "Online" : "Offline"}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
