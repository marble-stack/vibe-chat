import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useChatStore } from "../stores/chat";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";
import { isSupportedImageType, processIconImage } from "../lib/imageUtils";

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

export function Sidebar() {
  const user = useAuthStore((state) => state.user);
  const {
    communities, activeCommunityId, setActiveCommunity, setActiveChannel, addCommunity, updateCommunity,
    showCreateCommunityModal, showJoinCommunityModal, setShowCreateCommunityModal, setShowJoinCommunityModal,
  } = useChatStore();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  // Sync external modal triggers from store (e.g. WelcomeSplash buttons)
  const showCreateModal = showCreate || showCreateCommunityModal;
  const showJoinModal = showJoin || showJoinCommunityModal;

  const closeCreateModal = () => {
    setShowCreate(false);
    setShowCreateCommunityModal(false);
  };
  const closeJoinModal = () => {
    setShowJoin(false);
    setShowJoinCommunityModal(false);
  };
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
    closeCreateModal();
  };

  const handleIconFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!isSupportedImageType(file.type) && !file.name.toLowerCase().match(/\.(heic|heif)$/)) {
      alert("Please select a PNG, JPEG, JPG, GIF, WebP, or HEIC image.");
      return;
    }

    try {
      // Process (resize + convert) the image
      const processed = await processIconImage(file);
      setIconFile(processed);
      const reader = new FileReader();
      reader.onload = () => setIconPreview(reader.result as string);
      reader.readAsDataURL(processed);
      setShowStockPicker(false);
    } catch {
      alert("Failed to process image. HEIC files may not be supported in this browser.");
    }
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
      closeJoinModal();
      setActiveCommunity(community.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to join");
    }
  };

  // Change icon for an existing community
  const handleChangeCommunityIcon = async (communityId: string, file: File) => {
    try {
      const processed = await processIconImage(file);
      const result = await api.communities.uploadIcon(processed);
      await api.communities.update(communityId, { iconUrl: result.iconUrl });
      updateCommunity(communityId, { iconUrl: result.iconUrl });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update icon");
    }
  };

  return (
    <div className="w-[72px] bg-background-tertiary flex flex-col items-center py-3 gap-2 flex-shrink-0">
      {/* Communities */}
      {communities.map((community) => (
        <button
          key={community.id}
          onClick={() => {
            setActiveCommunity(community.id);
            setActiveChannel(null);
          }}
          className={`w-12 h-12 rounded-full flex items-center justify-center font-semibold transition-all overflow-hidden ${
            activeCommunityId === community.id
              ? "bg-accent-primary rounded-2xl ring-2 ring-accent-primary ring-offset-2 ring-offset-[rgb(var(--bg-tertiary))] text-white"
              : "bg-background-primary hover:bg-accent-primary hover:rounded-2xl text-text-primary hover:text-white"
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
        className="w-12 h-12 rounded-full bg-background-primary hover:bg-accent-hover hover:rounded-2xl flex items-center justify-center text-accent-primary hover:text-white transition-all text-2xl"
        title="Create Community"
      >
        +
      </button>

      {/* Join community */}
      <button
        onClick={() => setShowJoin(true)}
        className="w-12 h-12 rounded-full bg-background-primary hover:bg-accent-primary hover:rounded-2xl flex items-center justify-center text-accent-primary hover:text-white transition-all"
        title="Join Community"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
        </svg>
      </button>


      {/* Hidden file input for community icon change */}
      {communities.map((community) => (
        <input
          key={`icon-input-${community.id}`}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/heic,image/heif,.heic,.heif,.jpg,.jpeg"
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
      {showCreateModal &&
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
                  accept="image/png,image/jpeg,image/gif,image/webp,image/heic,image/heif,.heic,.heif,.jpg,.jpeg"
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
      {showJoinModal &&
        createPortal(
          <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100]"
            onClick={closeJoinModal}
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
                  onClick={closeJoinModal}
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
