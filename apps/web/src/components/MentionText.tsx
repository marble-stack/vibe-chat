import { parseMentions } from "../lib/mentions";

interface MentionTextProps {
  text: string;
  currentUserId?: string;
}

/**
 * Renders message text with @mentions highlighted.
 * Self-mentions get extra emphasis.
 */
export function MentionText({ text, currentUserId }: MentionTextProps) {
  const tokens = parseMentions(text);

  // If there are no mentions, render as plain text (avoid extra spans)
  if (tokens.length === 1 && tokens[0].type === "text") {
    return <>{text}</>;
  }

  return (
    <>
      {tokens.map((token, i) => {
        if (token.type === "text") {
          return <span key={i}>{token.text}</span>;
        }
        const isSelf = currentUserId && token.userId === currentUserId;
        return (
          <span
            key={i}
            className={`font-medium rounded px-0.5 ${
              isSelf
                ? "bg-accent-primary/20 text-accent-primary"
                : "text-accent-primary"
            }`}
          >
            @{token.displayName}
          </span>
        );
      })}
    </>
  );
}
