import { useState } from "react";
import { useChatStore } from "../stores/chat";
import { EmojiUploadModal } from "./EmojiUploadModal";

const UNICODE_EMOJIS = [
  "\u{1F600}", "\u{1F603}", "\u{1F604}", "\u{1F601}", "\u{1F606}", "\u{1F605}", "\u{1F602}", "\u{1F923}", "\u{1F60A}", "\u{1F607}",
  "\u{1F609}", "\u{1F60D}", "\u{1F929}", "\u{1F618}", "\u{1F617}", "\u{1F61A}", "\u{1F60B}", "\u{1F61C}", "\u{1F92A}", "\u{1F61D}",
  "\u{1F60E}", "\u{1F913}", "\u{1F9D0}", "\u{1F60F}", "\u{1F612}", "\u{1F61E}", "\u{1F614}", "\u{1F61F}", "\u{1F622}", "\u{1F62D}",
  "\u{1F624}", "\u{1F620}", "\u{1F621}", "\u{1F92C}", "\u{1F631}", "\u{1F628}", "\u{1F630}", "\u{1F625}", "\u{1F633}", "\u{1F914}",
  "\u{1F644}", "\u{1F611}", "\u{1F636}", "\u{1F60C}", "\u{1F634}", "\u{1F637}", "\u{1F912}", "\u{1F915}", "\u{1F922}", "\u{1F92E}",
  "\u{1F44D}", "\u{1F44E}", "\u{1F44A}", "\u270A", "\u{1F91E}", "\u270C\uFE0F", "\u{1F91F}", "\u{1F44B}", "\u{1F44F}", "\u{1F64C}",
  "\u2764\uFE0F", "\u{1F9E1}", "\u{1F49B}", "\u{1F49A}", "\u{1F499}", "\u{1F49C}", "\u{1F5A4}", "\u{1F494}", "\u{1F4AF}", "\u{1F4A5}",
  "\u{1F389}", "\u{1F38A}", "\u{1F525}", "\u2B50", "\u{1F31F}", "\u26A1", "\u{1F4A1}", "\u{1F3B5}", "\u{1F3B6}", "\u{1F4AC}",
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const [activeTab, setActiveTab] = useState<"unicode" | "custom">("unicode");
  const [showUploadModal, setShowUploadModal] = useState(false);
  const { activeCommunityId, customEmojis } = useChatStore();

  const communityEmojis = activeCommunityId ? customEmojis[activeCommunityId] || [] : [];

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute bottom-full right-0 mb-2 z-50 bg-background-secondary border border-background-tertiary rounded-lg shadow-lg w-[320px]">
        {/* Tabs */}
        <div className="flex border-b border-background-tertiary">
          <button
            type="button"
            onClick={() => setActiveTab("unicode")}
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
              activeTab === "unicode"
                ? "text-accent-primary border-b-2 border-accent-primary"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            Emoji
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("custom")}
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
              activeTab === "custom"
                ? "text-accent-primary border-b-2 border-accent-primary"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            Custom{communityEmojis.length > 0 ? ` (${communityEmojis.length})` : ""}
          </button>
        </div>

        {/* Content */}
        <div className="p-3">
          {activeTab === "unicode" ? (
            <div className="grid grid-cols-8 gap-1 max-h-[200px] overflow-y-auto">
              {UNICODE_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onSelect(emoji)}
                  className="w-8 h-8 flex items-center justify-center rounded hover:bg-background-primary/50 transition-colors text-lg"
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : (
            <div>
              {communityEmojis.length === 0 ? (
                <p className="text-text-muted text-sm text-center py-4">
                  No custom emojis yet
                </p>
              ) : (
                <div className="grid grid-cols-8 gap-1 max-h-[200px] overflow-y-auto">
                  {communityEmojis.map((emoji) => (
                    <button
                      key={emoji.id}
                      type="button"
                      onClick={() => onSelect(`:${emoji.name}:`)}
                      className="w-8 h-8 flex items-center justify-center rounded hover:bg-background-primary/50 transition-colors"
                      title={`:${emoji.name}:`}
                    >
                      <img
                        src={emoji.fileUrl}
                        alt={emoji.name}
                        className="w-6 h-6 object-contain"
                      />
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => setShowUploadModal(true)}
                className="w-full mt-2 px-3 py-1.5 text-xs text-accent-primary hover:bg-background-primary/50 rounded transition-colors flex items-center justify-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Emoji
              </button>
            </div>
          )}
        </div>
      </div>

      {showUploadModal && (
        <EmojiUploadModal onClose={() => setShowUploadModal(false)} />
      )}
    </>
  );
}
