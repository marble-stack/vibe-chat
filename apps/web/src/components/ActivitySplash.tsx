import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useChatStore } from "../stores/chat";

interface ActivityItem {
  communityId: string;
  communityName: string;
  communityIconUrl: string | null;
  memberCount: number;
  newMessageCount: number;
}

interface ActivitySplashProps {
  onDismiss: () => void;
}

export function ActivitySplash({ onDismiss }: ActivitySplashProps) {
  const [summary, setSummary] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const setActiveCommunity = useChatStore((s) => s.setActiveCommunity);

  useEffect(() => {
    api.communities.getActivitySummary()
      .then((data) => {
        setSummary(data.summary);
      })
      .catch(() => {
        // Silently fail — user can still dismiss
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSelectCommunity = (communityId: string) => {
    setActiveCommunity(communityId);
    onDismiss();
  };

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-lg w-full">
        <h2 className="text-xl font-bold text-text-primary mb-1 text-center">Welcome back!</h2>
        <p className="text-text-secondary mb-6 text-center text-sm">Here's what you missed.</p>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-background-secondary rounded-lg p-4 animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-background-tertiary" />
                  <div className="flex-1">
                    <div className="h-4 bg-background-tertiary rounded w-32 mb-2" />
                    <div className="h-3 bg-background-tertiary rounded w-48" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {summary.map((item) => (
              <button
                key={item.communityId}
                onClick={() => handleSelectCommunity(item.communityId)}
                className="w-full bg-background-secondary hover:bg-background-secondary/80 rounded-lg p-4 text-left transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-background-tertiary flex items-center justify-center text-white font-semibold flex-shrink-0 overflow-hidden">
                    {item.communityIconUrl ? (
                      <img src={item.communityIconUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      item.communityName.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-text-primary truncate group-hover:text-accent-primary transition-colors">
                      {item.communityName}
                    </div>
                    <div className="text-sm text-text-muted flex items-center gap-3">
                      {item.newMessageCount > 0 ? (
                        <span className="text-accent-primary font-medium">
                          {item.newMessageCount} new message{item.newMessageCount !== 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span>No new messages</span>
                      )}
                      <span>{item.memberCount} member{item.memberCount !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                  <svg className="w-5 h-5 text-text-muted group-hover:text-accent-primary transition-colors flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            ))}
          </div>
        )}

        <button
          onClick={onDismiss}
          className="mt-4 w-full text-center text-sm text-text-muted hover:text-text-primary transition-colors py-2"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
