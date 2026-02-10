interface Member {
  id: string;
  displayName: string;
}

interface MentionAutocompleteProps {
  members: Member[];
  selectedIndex: number;
  onSelect: (member: Member) => void;
}

/**
 * Dropdown popup for @mention autocomplete.
 * Positioned above the textarea, matching existing design system.
 */
export function MentionAutocomplete({
  members,
  selectedIndex,
  onSelect,
}: MentionAutocompleteProps) {
  if (members.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 mb-1 z-50 bg-background-secondary border border-background-tertiary rounded-lg shadow-lg py-1 max-h-[240px] overflow-y-auto w-[220px]">
      {members.map((member, index) => (
        <button
          key={member.id}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault(); // Prevent textarea blur
            onSelect(member);
          }}
          className={`w-full px-3 py-1.5 text-left flex items-center gap-2 text-sm transition-colors ${
            index === selectedIndex
              ? "bg-accent-primary/20 text-text-primary"
              : "text-text-primary hover:bg-background-primary/50"
          }`}
        >
          <div className="w-6 h-6 rounded-full bg-accent-primary flex-shrink-0 flex items-center justify-center text-white text-xs font-medium">
            {member.displayName.charAt(0).toUpperCase()}
          </div>
          <span className="truncate">{member.displayName}</span>
        </button>
      ))}
    </div>
  );
}
