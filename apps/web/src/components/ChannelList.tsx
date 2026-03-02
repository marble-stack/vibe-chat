import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useChatStore } from "../stores/chat";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";
import { isSupportedImageType, processIconImage } from "../lib/imageUtils";
import { useThemeStore, type ThemeName } from "../stores/theme";

interface ChannelListProps {
  showOnMobile?: boolean;
}

export function ChannelList({ showOnMobile = true }: ChannelListProps) {
  const user = useAuthStore((state) => state.user);
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

  const { updateCommunity } = useChatStore();
  const [showCreate, setShowCreate] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [contextMenuChannelId, setContextMenuChannelId] = useState<string | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [editChannelName, setEditChannelName] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showCommunitySettings, setShowCommunitySettings] = useState(false);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const communitySettingsRef = useRef<HTMLDivElement>(null);
  const communityIconInputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const currentTheme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

  const activeCommunity = communities.find((c) => c.id === activeCommunityId);
  const communityChannels = activeCommunityId ? channels[activeCommunityId] || [] : [];

  // Close community settings on outside click
  useEffect(() => {
    if (!showCommunitySettings) return;
    const handleClick = (e: MouseEvent) => {
      if (communitySettingsRef.current && !communitySettingsRef.current.contains(e.target as Node)) {
        setShowCommunitySettings(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showCommunitySettings]);

  const handleCommunityIconChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeCommunityId) return;
    e.target.value = "";

    if (!isSupportedImageType(file.type) && !file.name.toLowerCase().match(/\.(heic|heif)$/)) {
      alert("Please select a PNG, JPEG, GIF, WebP, or HEIC image.");
      return;
    }

    try {
      const processed = await processIconImage(file);
      const result = await api.communities.uploadIcon(processed);
      await api.communities.update(activeCommunityId, { iconUrl: result.iconUrl });
      updateCommunity(activeCommunityId, { iconUrl: result.iconUrl });
      setShowCommunitySettings(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update community photo");
    }
  };

  const handleRemoveCommunityIcon = async () => {
    if (!activeCommunityId) return;
    try {
      await api.communities.update(activeCommunityId, { iconUrl: null });
      updateCommunity(activeCommunityId, { iconUrl: undefined });
      setShowCommunitySettings(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to remove community photo");
    }
  };

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

  const [inviteCopied, setInviteCopied] = useState(false);

  const getInviteLink = () => {
    if (!activeCommunity) return "";
    return `${window.location.origin}/invite/${activeCommunity.inviteCode}`;
  };

  const getInviteMessage = () => {
    if (!activeCommunity) return "";
    return `Join me on Vibe Chat! ${getInviteLink()}\n\nOr use invite code: ${activeCommunity.inviteCode}`;
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(getInviteLink());
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  const handleShareText = () => {
    const body = encodeURIComponent(getInviteMessage());
    window.open(`sms:?&body=${body}`, "_self");
  };

  const handleShareEmail = () => {
    const subject = encodeURIComponent(`Join ${activeCommunity?.name} on Vibe Chat`);
    const body = encodeURIComponent(getInviteMessage());
    window.open(`mailto:?subject=${subject}&body=${body}`, "_self");
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Join ${activeCommunity?.name} on Vibe Chat`,
          text: getInviteMessage(),
          url: getInviteLink(),
        });
      } catch {
        // User cancelled share
      }
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
        className={`flex-1 min-w-0 md:flex-none md:w-60 bg-background-secondary flex flex-col ${showOnMobile ? "flex" : "hidden md:flex"}`}
      >
        <div className="flex-1 flex items-center justify-center text-text-muted">
          Select a community
        </div>
        {/* User info */}
        <div className="h-14 px-2 flex items-center gap-2 bg-background-tertiary/50">
          <button
            onClick={() => setShowThemePicker(true)}
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-background-primary/50 rounded transition-colors flex-shrink-0"
            title="Change Theme"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
            </svg>
          </button>
          <div className="w-8 h-8 rounded-full bg-accent-primary flex items-center justify-center text-white text-sm font-medium flex-shrink-0">
            {user?.displayName.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-text-primary truncate">
              {user?.displayName}
            </div>
          </div>
        </div>

        {/* Theme picker modal */}
        {showThemePicker && createPortal(
          <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100]"
            onClick={() => setShowThemePicker(false)}
          >
            <div
              className="bg-background-secondary rounded-lg p-6 w-full max-w-md mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-bold text-text-primary mb-4">Choose Theme</h2>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { name: "dark" as ThemeName, label: "Dark", desc: "Black with white text", colors: ["#1a1a1a", "#f0f0f0", "#4caf50"] },
                  { name: "light" as ThemeName, label: "Light", desc: "Grey with dark text", colors: ["#e8e8e8", "#2a2a2a", "#4caf50"] },
                  { name: "fun" as ThemeName, label: "Fun", desc: "Confetti with colors", colors: ["#fff8f0", "#1a1a1a", "#ff6b6b"] },
                  { name: "navy" as ThemeName, label: "Navy", desc: "Deep blue tones", colors: ["#1b2838", "#e0e8f0", "#5b9bd5"] },
                ]).map((t) => (
                  <button
                    key={t.name}
                    onClick={() => { setTheme(t.name); setShowThemePicker(false); }}
                    className={`relative rounded-lg p-4 border-2 transition-all text-left ${
                      currentTheme === t.name
                        ? "border-accent-primary shadow-lg"
                        : "border-background-tertiary hover:border-text-muted/50"
                    }`}
                    style={{ backgroundColor: t.colors[0] }}
                  >
                    <div className="font-semibold text-sm mb-1" style={{ color: t.colors[1] }}>{t.label}</div>
                    <div className="text-xs mb-2" style={{ color: t.colors[1], opacity: 0.7 }}>{t.desc}</div>
                    <div className="flex gap-1">
                      {t.colors.map((c, i) => (
                        <div key={i} className="w-4 h-4 rounded-full border border-white/20" style={{ backgroundColor: c }} />
                      ))}
                    </div>
                    {currentTheme === t.name && (
                      <div className="absolute top-2 right-2">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke={t.colors[2]} strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </button>
                ))}
              </div>
              <div className="flex justify-end mt-4">
                <button
                  onClick={() => setShowThemePicker(false)}
                  className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    );
  }

  return (
    <div
      className={`flex-1 min-w-0 md:flex-none md:w-60 bg-background-secondary flex flex-col ${showOnMobile ? "flex" : "hidden md:flex"}`}
    >
      {/* Community header */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-background-tertiary shadow-sm">
        <div className="flex items-center min-w-0 flex-1 gap-2">
          {activeCommunity?.iconUrl && (
            <img src={activeCommunity.iconUrl} alt="" className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
          )}
          <span className="font-semibold text-text-primary truncate">{activeCommunity?.name}</span>
        </div>
        <div className="flex items-center gap-1">
          {/* Community settings */}
          <div className="relative" ref={communitySettingsRef}>
            <button
              onClick={() => setShowCommunitySettings(!showCommunitySettings)}
              className="text-text-muted hover:text-text-primary p-1 rounded transition-colors"
              title="Community settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            {showCommunitySettings && (
              <div className="absolute right-0 top-full mt-1 bg-background-primary border border-background-tertiary rounded-lg shadow-lg py-1 z-[60] min-w-[180px]">
                <button
                  className="w-full px-3 py-2 text-left text-sm text-text-primary hover:bg-background-secondary flex items-center gap-2"
                  onClick={() => communityIconInputRef.current?.click()}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  {activeCommunity?.iconUrl ? "Change Photo" : "Add Photo"}
                </button>
                {activeCommunity?.iconUrl && (
                  <button
                    className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-background-secondary flex items-center gap-2"
                    onClick={handleRemoveCommunityIcon}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Remove Photo
                  </button>
                )}
              </div>
            )}
            <input
              ref={communityIconInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/heic,image/heif,.heic,.heif,.jpg,.jpeg"
              className="hidden"
              onChange={handleCommunityIconChange}
            />
          </div>
          <button
            onClick={() => setShowInvite(true)}
            className="text-text-muted hover:text-text-primary p-1"
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
        <button
          onClick={() => setShowThemePicker(true)}
          className="p-1.5 text-text-muted hover:text-text-primary hover:bg-background-primary/50 rounded transition-colors flex-shrink-0"
          title="Change Theme"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
          </svg>
        </button>
        <div className="w-8 h-8 rounded-full bg-accent-primary flex items-center justify-center text-white text-sm font-medium flex-shrink-0">
          {user?.displayName.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-text-primary truncate">{user?.displayName}</div>
        </div>
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

      {/* Invite modal - portaled to body */}
      {showInvite && createPortal(
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100]"
          onClick={() => setShowInvite(false)}
        >
          <div
            className="bg-background-secondary rounded-lg p-6 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold text-text-primary mb-4">Invite Friends</h2>
            <p className="text-text-secondary mb-2">Share this invite link:</p>

            {/* Invite link */}
            <div className="bg-background-tertiary rounded-lg px-3 py-2.5 mb-3 break-all">
              <span className="text-accent-primary text-sm font-medium">{getInviteLink()}</span>
            </div>

            {/* Raw code as secondary */}
            <p className="text-text-muted text-xs mb-4">
              Or share the invite code: <code className="text-text-secondary font-mono">{activeCommunity?.inviteCode}</code>
            </p>

            {/* Share buttons */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <button
                onClick={handleCopyLink}
                className="flex items-center justify-center gap-2 px-3 py-2.5 bg-accent-primary hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors"
              >
                {inviteCopied ? (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy Link
                  </>
                )}
              </button>

              <button
                onClick={handleShareEmail}
                className="flex items-center justify-center gap-2 px-3 py-2.5 bg-background-tertiary hover:bg-background-tertiary/80 text-text-primary rounded-lg text-sm font-medium transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Email
              </button>

              <button
                onClick={handleShareText}
                className="flex items-center justify-center gap-2 px-3 py-2.5 bg-background-tertiary hover:bg-background-tertiary/80 text-text-primary rounded-lg text-sm font-medium transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Text
              </button>

              {typeof navigator.share === "function" && (
                <button
                  onClick={handleNativeShare}
                  className="flex items-center justify-center gap-2 px-3 py-2.5 bg-background-tertiary hover:bg-background-tertiary/80 text-text-primary rounded-lg text-sm font-medium transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  More
                </button>
              )}
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setShowInvite(false)}
                className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Theme picker modal */}
      {showThemePicker && createPortal(
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100]"
          onClick={() => setShowThemePicker(false)}
        >
          <div
            className="bg-background-secondary rounded-lg p-6 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold text-text-primary mb-4">Choose Theme</h2>
            <div className="grid grid-cols-2 gap-3">
              {([
                { name: "dark" as ThemeName, label: "Dark", desc: "Black with white text", colors: ["#1a1a1a", "#f0f0f0", "#4caf50"] },
                { name: "light" as ThemeName, label: "Light", desc: "Grey with dark text", colors: ["#e8e8e8", "#2a2a2a", "#4caf50"] },
                { name: "fun" as ThemeName, label: "Fun", desc: "Confetti with colors", colors: ["#fff8f0", "#1a1a1a", "#ff6b6b"] },
                { name: "navy" as ThemeName, label: "Navy", desc: "Deep blue tones", colors: ["#1b2838", "#e0e8f0", "#5b9bd5"] },
              ]).map((t) => (
                <button
                  key={t.name}
                  onClick={() => { setTheme(t.name); setShowThemePicker(false); }}
                  className={`relative rounded-lg p-4 border-2 transition-all text-left ${
                    currentTheme === t.name
                      ? "border-accent-primary shadow-lg"
                      : "border-background-tertiary hover:border-text-muted/50"
                  }`}
                  style={{ backgroundColor: t.colors[0] }}
                >
                  <div className="font-semibold text-sm mb-1" style={{ color: t.colors[1] }}>{t.label}</div>
                  <div className="text-xs mb-2" style={{ color: t.colors[1], opacity: 0.7 }}>{t.desc}</div>
                  <div className="flex gap-1">
                    {t.colors.map((c, i) => (
                      <div key={i} className="w-4 h-4 rounded-full border border-white/20" style={{ backgroundColor: c }} />
                    ))}
                  </div>
                  {currentTheme === t.name && (
                    <div className="absolute top-2 right-2">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke={t.colors[2]} strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                </button>
              ))}
            </div>
            <div className="flex justify-end mt-4">
              <button
                onClick={() => setShowThemePicker(false)}
                className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
