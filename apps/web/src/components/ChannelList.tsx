import { useState, useRef, useEffect } from "react";
import { useChatStore } from "../stores/chat";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";

interface ChannelListProps {
  showOnMobile?: boolean;
  onOpenSidebar?: () => void;
}

export function ChannelList({ showOnMobile = true, onOpenSidebar }: ChannelListProps) {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const {
    communities,
    channels,
    activeCommunityId,
    activeChannelId,
    setActiveChannel,
    addChannel,
    updateChannel,
    removeChannel,
    unreadCounts,
    markChannelRead,
  } = useChatStore();

  const [showCreate, setShowCreate] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [contextMenuChannelId, setContextMenuChannelId] = useState<string | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [editChannelName, setEditChannelName] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

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

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenuChannelId) return;
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenuChannelId(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [contextMenuChannelId]);

  const handleChannelContextMenu = (e: React.MouseEvent, channelId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuChannelId(channelId);
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  };

  const handleEditChannel = (channelId: string, currentName: string) => {
    setContextMenuChannelId(null);
    setEditingChannelId(channelId);
    setEditChannelName(currentName);
  };

  const handleSaveEdit = async () => {
    if (!editingChannelId || !editChannelName.trim()) return;
    const name = editChannelName.trim().toLowerCase().replace(/\s+/g, "-");
    try {
      await api.channels.update(editingChannelId, { name });
      updateChannel(editingChannelId, { name });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to rename channel");
    }
    setEditingChannelId(null);
    setEditChannelName("");
  };

  const handleDeleteChannel = async (channelId: string) => {
    if (!activeCommunityId) return;
    try {
      await api.channels.delete(channelId);
      removeChannel(activeCommunityId, channelId);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete channel");
    }
    setShowDeleteConfirm(null);
  };

  if (!activeCommunityId) {
    return (
      <div
        className={`w-full md:w-60 bg-background-secondary flex flex-col ${showOnMobile ? "flex" : "hidden md:flex"}`}
      >
        {/* Mobile header with hamburger menu */}
        <div className="h-12 px-4 flex items-center border-b border-background-tertiary shadow-sm md:hidden">
          <button
            onClick={onOpenSidebar}
            className="p-1 -ml-1 text-text-muted hover:text-text-primary"
            title="Open sidebar"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center text-text-muted">
          Select a community
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
          <button
            onClick={logout}
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-background-primary/50 rounded transition-colors"
            title="Log out"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`w-full md:w-60 bg-background-secondary flex flex-col ${showOnMobile ? "flex" : "hidden md:flex"}`}
    >
      {/* Community header */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-background-tertiary shadow-sm">
        <div className="flex items-center min-w-0 flex-1">
          <button
            onClick={onOpenSidebar}
            className="p-1 -ml-1 mr-2 text-text-muted hover:text-text-primary md:hidden flex-shrink-0"
            title="Open communities"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
          <span className="font-semibold text-text-primary truncate">{activeCommunity?.name}</span>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="text-text-muted hover:text-text-primary"
          title="Invite people"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
            />
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
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
        </div>

        {communityChannels.map((channel) => {
          const unread = unreadCounts[channel.id] || 0;

          if (editingChannelId === channel.id) {
            return (
              <div key={channel.id} className="flex items-center gap-1 px-2 py-1">
                <span className="text-lg text-text-muted">#</span>
                <input
                  type="text"
                  value={editChannelName}
                  onChange={(e) => setEditChannelName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveEdit();
                    if (e.key === "Escape") { setEditingChannelId(null); setEditChannelName(""); }
                  }}
                  className="flex-1 bg-background-tertiary text-text-primary rounded px-2 py-0.5 text-sm outline-none focus:ring-1 focus:ring-accent-primary min-w-0"
                  autoFocus
                />
                <button
                  onClick={handleSaveEdit}
                  className="text-green-400 hover:text-green-300 p-0.5 flex-shrink-0"
                  title="Save"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </button>
                <button
                  onClick={() => { setEditingChannelId(null); setEditChannelName(""); }}
                  className="text-text-muted hover:text-text-primary p-0.5 flex-shrink-0"
                  title="Cancel"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            );
          }

          return (
            <div
              key={channel.id}
              className={`group w-full px-2 py-1 rounded flex items-center gap-2 cursor-pointer ${
                activeChannelId === channel.id
                  ? "bg-background-primary/50 text-text-primary"
                  : unread > 0
                    ? "text-text-primary font-semibold hover:bg-background-primary/30"
                    : "text-channel-default hover:text-channel-hover hover:bg-background-primary/30"
              }`}
              onClick={() => {
                setActiveChannel(channel.id);
                markChannelRead(channel.id);
              }}
              onContextMenu={(e) => handleChannelContextMenu(e, channel.id)}
            >
              <span className="text-lg">#</span>
              <span className="truncate flex-1 text-left">{channel.name}</span>
              {unread > 0 && (
                <span className="bg-accent-primary text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleChannelContextMenu(e, channel.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 text-text-muted hover:text-text-primary transition-opacity flex-shrink-0"
                title="Channel settings"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>

      {/* User info */}
      <div className="h-14 px-2 flex items-center gap-2 bg-background-tertiary/50">
        <div className="w-8 h-8 rounded-full bg-accent-primary flex items-center justify-center text-white text-sm font-medium">
          {user?.displayName.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-text-primary truncate">{user?.displayName}</div>
        </div>
        <button
          onClick={logout}
          className="p-1.5 text-text-muted hover:text-text-primary hover:bg-background-primary/50 rounded transition-colors"
          title="Log out"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
        </button>
      </div>

      {/* Create channel modal */}
      {showCreate && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowCreate(false)}
        >
          <div
            className="bg-background-secondary rounded-lg p-6 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
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

      {/* Channel context menu */}
      {contextMenuChannelId && (
        <div
          ref={contextMenuRef}
          className="fixed bg-background-primary border border-background-tertiary rounded-lg shadow-lg py-1 z-[60] min-w-[140px]"
          style={{ top: contextMenuPos.y, left: contextMenuPos.x }}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-text-primary hover:bg-background-secondary flex items-center gap-2"
            onClick={() => {
              const ch = communityChannels.find((c) => c.id === contextMenuChannelId);
              if (ch) handleEditChannel(ch.id, ch.name);
            }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Edit
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-red-400 hover:bg-background-secondary flex items-center gap-2"
            onClick={() => {
              setShowDeleteConfirm(contextMenuChannelId);
              setContextMenuChannelId(null);
            }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
        </div>
      )}

      {/* Delete channel confirmation */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowDeleteConfirm(null)}
        >
          <div
            className="bg-background-secondary rounded-lg p-6 w-full max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold text-text-primary mb-2">Delete Channel</h2>
            <p className="text-text-secondary mb-4">
              Are you sure you want to delete{" "}
              <strong className="text-text-primary">
                #{communityChannels.find((c) => c.id === showDeleteConfirm)?.name}
              </strong>
              ? This will permanently delete all messages in this channel.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 text-text-secondary hover:underline"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteChannel(showDeleteConfirm)}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invite modal */}
      {showInvite && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowInvite(false)}
        >
          <div
            className="bg-background-secondary rounded-lg p-6 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
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
