import { useChatStore } from "../stores/chat";
import { MentionText } from "./MentionText";

const CUSTOM_EMOJI_REGEX = /:([a-z0-9_]+):/g;

interface CustomEmojiTextProps {
  text: string;
  currentUserId?: string;
}

/**
 * Renders text with :custom_emoji: patterns replaced by <img> tags.
 * Text segments are rendered through MentionText so @mentions still work.
 * Falls back to the raw text if no matching emoji is found.
 */
export function CustomEmojiText({ text, currentUserId }: CustomEmojiTextProps) {
  const { activeCommunityId, customEmojis } = useChatStore();
  const communityEmojis = activeCommunityId ? customEmojis[activeCommunityId] || [] : [];

  if (communityEmojis.length === 0 || !text.includes(":")) {
    return <MentionText text={text} currentUserId={currentUserId} />;
  }

  const parts: (string | { name: string; url: string })[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(CUSTOM_EMOJI_REGEX)) {
    const emojiName = match[1];
    const emoji = communityEmojis.find((e) => e.name === emojiName);

    if (emoji) {
      if (match.index! > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      parts.push({ name: emojiName, url: emoji.fileUrl });
      lastIndex = match.index! + match[0].length;
    }
  }

  // If no custom emojis were found, render through MentionText
  if (parts.length === 0) {
    return <MentionText text={text} currentUserId={currentUserId} />;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return (
    <>
      {parts.map((part, i) =>
        typeof part === "string" ? (
          <MentionText key={i} text={part} currentUserId={currentUserId} />
        ) : (
          <img
            key={i}
            src={part.url}
            alt={`:${part.name}:`}
            title={`:${part.name}:`}
            className="inline-block w-5 h-5 align-text-bottom object-contain"
          />
        )
      )}
    </>
  );
}

/**
 * Renders an emoji string — either a custom emoji (:name:) as an image,
 * or a unicode emoji as text.
 */
export function EmojiDisplay({ emoji }: { emoji: string }) {
  const { activeCommunityId, customEmojis } = useChatStore();

  const match = emoji.match(/^:([a-z0-9_]+):$/);
  if (match) {
    const communityEmojis = activeCommunityId ? customEmojis[activeCommunityId] || [] : [];
    const customEmoji = communityEmojis.find((e) => e.name === match[1]);
    if (customEmoji) {
      return (
        <img
          src={customEmoji.fileUrl}
          alt={emoji}
          title={emoji}
          className="inline-block w-5 h-5 object-contain"
        />
      );
    }
  }
  return <span>{emoji}</span>;
}
