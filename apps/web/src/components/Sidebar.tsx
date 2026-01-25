import { useState } from "react";
import { useChatStore } from "../stores/chat";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";

interface SidebarProps {
  showMobile: boolean;
  onClose: () => void;
}

export function Sidebar({ showMobile, onClose }: SidebarProps) {
  const user = useAuthStore((state) => state.user);
  const { communities, activeCommunityId, setActiveCommunity, setActiveChannel, addCommunity } = useChatStore();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [newName, setNewName] = useState("");
  const [inviteCode, setInviteCode] = useState("");

  const handleCreate = async () => {
    if (!user || !newName.trim()) return;

    const { community } = await api.communities.create({
      name: newName.trim(),
      userId: user.id,
    });

    addCommunity(community);
    setNewName("");
    setShowCreate(false);
    setActiveCommunity(community.id);
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

  return (
    <div
      className={`w-[72px] bg-background-tertiary flex flex-col items-center py-3 gap-2 transition-transform md:translate-x-0 ${
        showMobile ? 'fixed left-0 top-0 bottom-0 z-50 translate-x-0' : 'fixed left-0 top-0 bottom-0 -translate-x-full md:relative'
      }`}
    >
      {/* Communities */}
      {communities.map((community) => (
        <button
          key={community.id}
          onClick={() => {
            setActiveCommunity(community.id);
            setActiveChannel(null);
            onClose(); // Close mobile sidebar when selecting a community
          }}
          className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold transition-all ${
            activeCommunityId === community.id
              ? "bg-accent-primary rounded-2xl"
              : "bg-background-primary hover:bg-accent-primary hover:rounded-2xl"
          }`}
          title={community.name}
        >
          {community.iconUrl ? (
            <img src={community.iconUrl} alt="" className="w-full h-full rounded-full object-cover" />
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

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="bg-background-secondary rounded-lg p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-text-primary mb-4">Create a Community</h2>
            <input
              type="text"
              placeholder="Community name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full bg-background-tertiary text-text-primary rounded px-3 py-2 mb-4 outline-none focus:ring-2 focus:ring-accent-primary"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-text-secondary hover:underline"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                className="px-4 py-2 bg-accent-primary hover:bg-accent-hover text-white rounded"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Join modal */}
      {showJoin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowJoin(false)}>
          <div className="bg-background-secondary rounded-lg p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-text-primary mb-4">Join a Community</h2>
            <input
              type="text"
              placeholder="Invite code"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              className="w-full bg-background-tertiary text-text-primary rounded px-3 py-2 mb-4 outline-none focus:ring-2 focus:ring-accent-primary"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowJoin(false)}
                className="px-4 py-2 text-text-secondary hover:underline"
              >
                Cancel
              </button>
              <button
                onClick={handleJoin}
                className="px-4 py-2 bg-accent-primary hover:bg-accent-hover text-white rounded"
              >
                Join
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
