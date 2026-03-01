import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useChatStore } from "../stores/chat";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";

const STOCK_IMAGES = [
  "https://images.unsplash.com/photo-1557683316-973673baf926?w=128&h=128&fit=crop",
  "https://images.unsplash.com/photo-1558591710-4b4a1ae0f04d?w=128&h=128&fit=crop",
  "https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=128&h=128&fit=crop",
  "https://images.unsplash.com/photo-1557682250-33bd709cbe85?w=128&h=128&fit=crop",
  "https://images.unsplash.com/photo-1557682224-5b8590cd9ec5?w=128&h=128&fit=crop",
  "https://images.unsplash.com/photo-1557682260-96773eb01377?w=128&h=128&fit=crop",
  "https://images.unsplash.com/photo-1614850523459-c2f4c699c52e?w=128&h=128&fit=crop",
  "https://images.unsplash.com/photo-1620121692029-d088224ddc74?w=128&h=128&fit=crop",
];

interface SidebarProps {
  showMobile: boolean;
  onClose: () => void;
}

export function Sidebar({ showMobile, onClose }: SidebarProps) {
  const user = useAuthStore((state) => state.user);
  const { communities, activeCommunityId, setActiveCommunity, setActiveChannel, addCommunity, updateCommunity } =
    useChatStore();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [newName, setNewName] = useState("");
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [showStockPicker, setShowStockPicker] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetCreateModal = () => {
    setNewName("");
    setIconPreview(null);
    setIconFile(null);
    setShowStockPicker(false);
    setShowCreate(false);
  };

  const handleIconFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) {
      alert("Please select a PNG, JPEG, GIF, or WebP image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      alert("Image must be under 2MB.");
      return;
    }

    setIconFile(file);
    const reader = new FileReader();
    reader.onload = () => setIconPreview(reader.result as string);
    reader.readAsDataURL(file);
    setShowStockPicker(false);
  };

  const handleSelectStock = (url: string) => {
    setIconPreview(url);
    setIconFile(null);
    setShowStockPicker(false);
  };

  const handleCreate = async () => {
    if (!user || !newName.trim()) return;
    setUploading(true);

    try {
      let iconUrl: string | undefined;

      if (iconFile) {
        const result = await api.communities.uploadIcon(iconFile);
        iconUrl = result.iconUrl;
      } else if (iconPreview) {
        iconUrl = iconPreview;
      }

      const { community } = await api.communities.create({
        name: newName.trim(),
        userId: user.id,
        iconUrl,
      });

      addCommunity(community);
      resetCreateModal();
      setActiveCommunity(community.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create community");
    } finally {
      setUploading(false);
    }
  };

  const handleJoin = async () => {
    if (!user || !inviteCode.trim()) return;

    try {
      const { community } = await api.communities.join(inviteCode.trim(), user.id);
      addCommunity(community);
      setInviteCode("");
      setShowJoin(false);
      setActiveCommunity(community.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to join");
    }
  };

  // Change icon for an existing community
  const handleChangeCommunityIcon = async (communityId: string, file: File) => {
    try {
      const result = await api.communities.uploadIcon(file);
      await api.communities.update(communityId, { iconUrl: result.iconUrl });
      updateCommunity(communityId, { iconUrl: result.iconUrl });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update icon");
    }
  };

  return (
    <div
      className={`w-[72px] bg-background-tertiary flex flex-col items-center py-3 gap-2 transition-transform md:translate-x-0 ${
        showMobile
          ? "fixed left-0 top-0 bottom-0 z-50 translate-x-0"
          : "fixed left-0 top-0 bottom-0 -translate-x-full md:relative"
      }`}
    >
      {/* Communities */}
      {communities.map((community) => (
        <button
          key={community.id}
          onClick={() => {
            setActiveCommunity(community.id);
            setActiveChannel(null);
            onClose();
          }}
          className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold transition-all overflow-hidden ${
            activeCommunityId === community.id
              ? "bg-accent-primary rounded-2xl"
              : "bg-background-primary hover:bg-accent-primary hover:rounded-2xl"
          }`}
          title={community.name}
        >
          {community.iconUrl ? (
            <img
              src={community.iconUrl}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            community.name.charAt(0).toUpperCase()
          )}
        </button>
      ))}

      {/* Divider */}
      <div className="w-8 h-[2px] bg-background-primary rounded-full my-1" />

      {/* Add community */}
      <button
        onClick={() => setShowCreate(true)}
        className="w-12 h-12 rounded-full bg-background-primary hover:bg-green-600 hover:rounded-2xl flex items-center justify-center text-green-500 hover:text-white transition-all text-2xl"
        title="Create Community"
      >
        +
      </button>

      {/* Join community */}
      <button
        onClick={() => setShowJoin(true)}
        className="w-12 h-12 rounded-full bg-background-primary hover:bg-accent-primary hover:rounded-2xl flex items-center justify-center text-green-500 hover:text-white transition-all text-xl"
        title="Join Community"
      >
        ↗
      </button>

      {/* Hidden file input for community icon change */}
      {communities.map((community) => (
        <input
          key={`icon-input-${community.id}`}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          id={`community-icon-${community.id}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleChangeCommunityIcon(community.id, file);
            e.target.value = "";
          }}
        />
      ))}

      {/* Create modal - portaled to body to escape transform containing block */}
      {showCreate &&
        createPortal(
          <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100]"
            onClick={resetCreateModal}
          >
            <div
              className="bg-background-secondary rounded-lg p-8 w-[90vw] max-w-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-2xl font-bold text-text-primary mb-6">Create a Community</h2>

              {/* Icon selection */}
              <div className="flex flex-col items-center mb-6">
                <div
                  className="w-20 h-20 rounded-full bg-background-primary flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity overflow-hidden border-2 border-dashed border-text-muted/30 hover:border-accent-primary"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {iconPreview ? (
                    <img src={iconPreview} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center text-text-muted">
                      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  className="hidden"
                  onChange={handleIconFileChange}
                />
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs text-accent-primary hover:underline"
                  >
                    Upload
                  </button>
                  <span className="text-xs text-text-muted">or</span>
                  <button
                    type="button"
                    onClick={() => setShowStockPicker(!showStockPicker)}
                    className="text-xs text-accent-primary hover:underline"
                  >
                    Pick a stock image
                  </button>
                  {iconPreview && (
                    <>
                      <span className="text-xs text-text-muted">or</span>
                      <button
                        type="button"
                        onClick={() => { setIconPreview(null); setIconFile(null); }}
                        className="text-xs text-red-400 hover:underline"
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Stock image picker */}
              {showStockPicker && (
                <div className="grid grid-cols-4 gap-2 mb-6">
                  {STOCK_IMAGES.map((url, i) => (
                    <button
                      key={i}
                      onClick={() => handleSelectStock(url)}
                      className={`w-full aspect-square rounded-lg overflow-hidden border-2 transition-colors ${
                        iconPreview === url ? "border-accent-primary" : "border-transparent hover:border-text-muted/50"
                      }`}
                    >
                      <img src={url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}

              <input
                type="text"
                placeholder="Community name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full bg-background-primary border border-text-muted/30 text-text-primary placeholder:text-text-muted rounded px-4 py-3 mb-6 text-lg outline-none focus:ring-2 focus:ring-accent-primary"
                autoFocus
              />
              <div className="flex gap-3 justify-end">
                <button
                  onClick={resetCreateModal}
                  className="px-5 py-2.5 text-text-secondary hover:text-text-primary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={uploading}
                  className="px-5 py-2.5 bg-accent-primary hover:bg-accent-hover text-white rounded font-medium disabled:opacity-50"
                >
                  {uploading ? "Creating..." : "Create"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Join modal - portaled to body to escape transform containing block */}
      {showJoin &&
        createPortal(
          <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100]"
            onClick={() => setShowJoin(false)}
          >
            <div
              className="bg-background-secondary rounded-lg p-8 w-[90vw] max-w-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-2xl font-bold text-text-primary mb-6">Join a Community</h2>
              <input
                type="text"
                placeholder="Invite code"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                className="w-full bg-background-primary border border-text-muted/30 text-text-primary placeholder:text-text-muted rounded px-4 py-3 mb-6 text-lg outline-none focus:ring-2 focus:ring-accent-primary"
                autoFocus
              />
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowJoin(false)}
                  className="px-5 py-2.5 text-text-secondary hover:text-text-primary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleJoin}
                  className="px-5 py-2.5 bg-accent-primary hover:bg-accent-hover text-white rounded font-medium"
                >
                  Join
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
