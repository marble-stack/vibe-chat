import { useState } from "react";
import { useChatStore } from "../stores/chat";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";

export function ChannelList() {
  const user = useAuthStore((state) => state.user);
  const {
    communities,
    channels,
    activeCommunityId,
    activeChannelId,
    setActiveChannel,
    addChannel,
  } = useChatStore();

  const [showCreate, setShowCreate] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [showInvite, setShowInvite] = useState(false);

  const activeCommunity = communities.find((c) => c.id === activeCommunityId);
  const communityChannels = activeCommunityId ? channels[activeCommunityId] || [] : [];

  const handleCreateChannel = async () => {
    if (!activeCommunityId || !newChannelName.trim()) return;

    const name = newChannelName.trim().toLowerCase().replace(/\s+/g, "-");
    const { channel } = await api.channels.create({
      communityId: activeCommunityId,
      name,
    });

    addChannel(channel);
    setNewChannelName("");
    setShowCreate(false);
  };

  const copyInviteCode = () => {
    if (activeCommunity) {
      navigator.clipboard.writeText(activeCommunity.inviteCode);
      alert("Invite code copied!");
    }
  };

  if (!activeCommunityId) {
    return (
      <div className="w-60 bg-background-secondary flex items-center justify-center text-text-muted">
        Select a community
      </div>
    );
  }

  return (
    <div className="w-60 bg-background-secondary flex flex-col">
      {/* Community header */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-background-tertiary shadow-sm">
        <span className="font-semibold text-text-primary truncate">
          {activeCommunity?.name}
        </span>
        <button
          onClick={() => setShowInvite(true)}
          className="text-text-muted hover:text-text-primary"
          title="Invite people"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
        </button>
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="flex items-center justify-between px-2 mb-1">
          <span className="text-xs font-semibold text-text-muted uppercase">Channels</span>
          <button
            onClick={() => setShowCreate(true)}
            className="text-text-muted hover:text-text-primary"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>

        {communityChannels.map((channel) => (
          <button
            key={channel.id}
            onClick={() => setActiveChannel(channel.id)}
            className={`w-full px-2 py-1 rounded flex items-center gap-2 ${
              activeChannelId === channel.id
                ? "bg-background-primary/50 text-text-primary"
                : "text-channel-default hover:text-channel-hover hover:bg-background-primary/30"
            }`}
          >
            <span className="text-lg">#</span>
            <span className="truncate">{channel.name}</span>
          </button>
        ))}
      </div>

      {/* User info */}
      <div className="h-14 px-2 flex items-center gap-2 bg-background-tertiary/50">
        <div className="w-8 h-8 rounded-full bg-accent-primary flex items-center justify-center text-white text-sm font-medium">
          {user?.displayName.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-text-primary truncate">
            {user?.displayName}
          </div>
        </div>
      </div>

      {/* Create channel modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="bg-background-secondary rounded-lg p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-text-primary mb-4">Create Channel</h2>
            <div className="flex items-center gap-2 bg-background-tertiary rounded px-3 py-2 mb-4">
              <span className="text-text-muted text-lg">#</span>
              <input
                type="text"
                placeholder="new-channel"
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
                className="flex-1 bg-transparent text-text-primary outline-none"
                autoFocus
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-text-secondary hover:underline"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateChannel}
                className="px-4 py-2 bg-accent-primary hover:bg-accent-hover text-white rounded"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invite modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowInvite(false)}>
          <div className="bg-background-secondary rounded-lg p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-text-primary mb-4">Invite Friends</h2>
            <p className="text-text-secondary mb-4">Share this invite code:</p>
            <div className="flex items-center gap-2 bg-background-tertiary rounded px-3 py-2 mb-4">
              <code className="flex-1 text-text-primary font-mono">
                {activeCommunity?.inviteCode}
              </code>
              <button
                onClick={copyInviteCode}
                className="px-3 py-1 bg-accent-primary hover:bg-accent-hover text-white rounded text-sm"
              >
                Copy
              </button>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setShowInvite(false)}
                className="px-4 py-2 text-text-secondary hover:underline"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
