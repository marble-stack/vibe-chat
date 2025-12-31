import { useChatStore } from "../stores/chat";

export function MemberList() {
  const { members, activeCommunityId } = useChatStore();
  const communityMembers = activeCommunityId ? members[activeCommunityId] || [] : [];

  return (
    <div className="w-60 bg-background-secondary hidden md:hidden lg:block">
      <div className="p-4">
        <h3 className="text-xs font-semibold text-text-muted uppercase mb-2">
          Members — {communityMembers.length}
        </h3>

        <div className="space-y-1">
          {communityMembers.map((member) => (
            <div
              key={member.id}
              className="flex items-center gap-3 px-2 py-1 rounded hover:bg-background-primary/30 cursor-pointer"
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
                {/* Online indicator - placeholder */}
                <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-background-secondary" />
              </div>
              <span className="text-text-secondary truncate">
                {member.displayName}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
