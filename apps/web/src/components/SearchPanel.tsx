import { useEffect, useRef } from "react";
import { useChatStore } from "../stores/chat";
import { MentionText } from "./MentionText";
import { useAuthStore } from "../stores/auth";

const formatTime = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  }) + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export function SearchPanel() {
  const { searchQuery, searchResults, searchMessages, setSearchOpen, setScrollToMessage, members, activeCommunityId } =
    useChatStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const user = useAuthStore((state) => state.user);
  const communityMembers = activeCommunityId ? members[activeCommunityId] || [] : [];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSearchOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [setSearchOpen]);

  const getMemberName = (userId: string) =>
    communityMembers.find((m) => m.id === userId)?.displayName || "Unknown";

  return (
    <div className="fixed inset-0 z-50 md:static md:inset-auto md:z-auto md:w-80 bg-background-secondary border-l border-background-tertiary flex flex-col h-full">
      {/* Header */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-background-tertiary shadow-sm">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSearchOpen(false)}
            className="text-text-muted hover:text-text-primary p-1 md:hidden"
            title="Back"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <span className="font-semibold text-text-primary">Search</span>
        </div>
        <button
          onClick={() => setSearchOpen(false)}
          className="text-text-muted hover:text-text-primary p-1 hidden md:block"
          title="Close search"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Search input */}
      <div className="p-3">
        <div className="flex items-center gap-2 bg-background-tertiary rounded-lg px-3 py-2">
          <svg className="w-4 h-4 text-text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => searchMessages(e.target.value)}
            placeholder="Search messages..."
            className="flex-1 bg-transparent text-text-primary outline-none text-sm"
          />
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {searchQuery && searchResults.length === 0 && (
          <div className="text-center text-text-muted text-sm py-8">No results found</div>
        )}
        {searchResults.map((msg) => {
          const text = msg.plaintext || msg.ciphertext;
          let displayText = text;
          try {
            const parsed = JSON.parse(text);
            if (parsed.type === "file") displayText = `File: ${parsed.filename}`;
            else if (parsed.type === "poll") displayText = `Poll: ${parsed.question}`;
          } catch {
            // Not JSON
          }

          return (
            <button
              key={msg.id}
              onClick={() => {
                setScrollToMessage(msg.id);
                setSearchOpen(false);
              }}
              className="w-full text-left px-4 py-3 hover:bg-background-primary/30 border-b border-background-tertiary/50 transition-colors"
            >
              <div className="flex items-baseline gap-2 mb-0.5">
                <span className="text-sm font-medium text-text-primary">
                  {getMemberName(msg.senderId)}
                </span>
                <span className="text-xs text-text-muted">{formatTime(msg.createdAt)}</span>
              </div>
              <p className="text-sm text-text-secondary truncate">
                <MentionText text={displayText} currentUserId={user?.id} />
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
