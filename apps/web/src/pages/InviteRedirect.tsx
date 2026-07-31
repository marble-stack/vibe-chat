import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import { useChatStore } from "../stores/chat";
import { api } from "../lib/api";

export function InviteRedirect() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { communities, addCommunity, setActiveCommunity } = useChatStore();
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(true);

  useEffect(() => {
    if (!user || !inviteCode) return;

    const joinCommunity = async () => {
      try {
        const { community } = await api.communities.join(inviteCode);
        addCommunity(community);
        setActiveCommunity(community.id);
        navigate("/chat", { replace: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to join";
        if (message === "Already a member") {
          // Find the community by invite code and navigate to it
          const existing = communities.find((c) => c.inviteCode === inviteCode);
          if (existing) {
            setActiveCommunity(existing.id);
            navigate("/chat", { replace: true });
            return;
          }
          // If not in local state yet, reload communities list
          try {
            const { communities: freshList } = await api.communities.list(user.id);
            useChatStore.getState().setCommunities(freshList);
            const match = freshList.find((c) => c.inviteCode === inviteCode);
            if (match) {
              setActiveCommunity(match.id);
              navigate("/chat", { replace: true });
              return;
            }
          } catch {
            // Fall through to show generic message
          }
          // Still couldn't find it — just go to chat
          navigate("/chat", { replace: true });
          return;
        }
        setError(message);
      } finally {
        setJoining(false);
      }
    };

    joinCommunity();
  }, [user, inviteCode, navigate, addCommunity, setActiveCommunity, communities]);

  if (joining) {
    return (
      <div className="min-h-screen bg-background-tertiary flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-accent-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-text-secondary">Joining community...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background-tertiary flex items-center justify-center p-4">
        <div className="bg-background-secondary rounded-lg p-8 w-full max-w-md text-center">
          <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-text-primary mb-2">Could not join</h2>
          <p className="text-text-secondary mb-6">{error}</p>
          <button
            onClick={() => navigate("/chat", { replace: true })}
            className="px-6 py-2.5 bg-accent-primary hover:bg-accent-hover text-white rounded-lg font-medium transition-colors"
          >
            Go to Chat
          </button>
        </div>
      </div>
    );
  }

  return null;
}
