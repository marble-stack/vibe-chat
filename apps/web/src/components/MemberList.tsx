import { useState } from "react";
import { useChatStore } from "../stores/chat";
import { ProfileCard } from "./ProfileCard";

export function MemberList() {
  const { members, activeCommunityId, onlineUsers } = useChatStore();
  const [profileCard, setProfileCard] = useState<{
    userId: string;
    position: { x: number; y: number };
  } | null>(null);
  const communityMembers = activeCommunityId ? members[activeCommunityId] || [] : [];
  const onlineUserIds = activeCommunityId ? onlineUsers[activeCommunityId] || [] : [];

  // Sort members: online first, then alphabetically
  const sortedMembers = [...communityMembers].sort((a, b) => {
    const aOnline = onlineUserIds.includes(a.id);
    const bOnline = onlineUserIds.includes(b.id);
    if (aOnline && !bOnline) return -1;
    if (!aOnline && bOnline) return 1;
    return a.displayName.localeCompare(b.displayName);
  });

  const onlineCount = communityMembers.filter((m) => onlineUserIds.includes(m.id)).length;

  const renderMember = (member: (typeof communityMembers)[0]) => {
    const isOnline = onlineUserIds.includes(member.id);

    return (
      <div
        key={member.id}
        className={`flex items-center gap-3 px-2 py-1 rounded hover:bg-background-primary/30 cursor-pointer ${
          !isOnline ? "opacity-50" : ""
        }`}
        onClick={(e) =>
          setProfileCard({
            userId: member.id,
            position: { x: e.clientX, y: e.clientY },
          })
        }
      >
        <div className="relative">
          <div className="w-8 h-8 rounded-full bg-accent-primary flex items-center justify-center text-white text-sm font-medium">
            {member.avatarUrl ? (
              <img
                src={member.avatarUrl}
                alt=""
                className="w-full h-full rounded-full object-cover"
              />
            ) : (
              member.displayName.charAt(0).toUpperCase()
            )}
          </div>
          {/* Online indicator */}
          <div
            className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-background-secondary ${
              isOnline ? "bg-green-500" : "bg-gray-500"
            }`}
          />
        </div>
        <span className="text-text-secondary truncate">{member.displayName}</span>
      </div>
    );
  };

  const onlineMembers = sortedMembers.filter((m) => onlineUserIds.includes(m.id));
  const offlineMembers = sortedMembers.filter((m) => !onlineUserIds.includes(m.id));

  const profileMember = profileCard
    ? communityMembers.find((m) => m.id === profileCard.userId)
    : null;

  return (
    <div className="w-60 bg-background-secondary hidden lg:block overflow-y-auto">
      {profileCard && profileMember && (
        <ProfileCard
          displayName={profileMember.displayName}
          avatarUrl={profileMember.avatarUrl}
          isOnline={onlineUserIds.includes(profileCard.userId)}
          position={profileCard.position}
          onClose={() => setProfileCard(null)}
        />
      )}
      <div className="p-4">
        {/* Online members */}
        {onlineMembers.length > 0 && (
          <>
            <h3 className="text-xs font-semibold text-text-muted uppercase mb-2">
              Online — {onlineCount}
            </h3>
            <div className="space-y-1 mb-4">{onlineMembers.map(renderMember)}</div>
          </>
        )}

        {/* Offline members */}
        {offlineMembers.length > 0 && (
          <>
            <h3 className="text-xs font-semibold text-text-muted uppercase mb-2">
              Offline — {offlineMembers.length}
            </h3>
            <div className="space-y-1">{offlineMembers.map(renderMember)}</div>
          </>
        )}
      </div>
    </div>
  );
}
