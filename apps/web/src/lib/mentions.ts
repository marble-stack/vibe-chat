/**
 * @ Mention utilities for E2E encrypted messages.
 *
 * Mention format: @[displayName](userId)
 * This embeds the UUID so mentions survive display name changes.
 * All parsing is client-side only — the server never sees plaintext.
 */

export interface MentionToken {
  type: "text" | "mention";
  text: string;
  /** Only present for mention tokens */
  userId?: string;
  /** Only present for mention tokens */
  displayName?: string;
}

const MENTION_REGEX = /@\[([^\]]+)\]\(([a-f0-9-]+)\)/g;

/**
 * Parse a message string into an array of text and mention tokens.
 */
export function parseMentions(text: string): MentionToken[] {
  const tokens: MentionToken[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(MENTION_REGEX)) {
    const matchStart = match.index!;
    // Add preceding text
    if (matchStart > lastIndex) {
      tokens.push({ type: "text", text: text.slice(lastIndex, matchStart) });
    }
    tokens.push({
      type: "mention",
      text: match[0],
      displayName: match[1],
      userId: match[2],
    });
    lastIndex = matchStart + match[0].length;
  }

  // Add trailing text
  if (lastIndex < text.length) {
    tokens.push({ type: "text", text: text.slice(lastIndex) });
  }

  return tokens;
}

/**
 * Build a mention string from a display name and user ID.
 */
export function buildMentionText(displayName: string, userId: string): string {
  return `@[${displayName}](${userId})`;
}

/**
 * Detect if the user is currently typing a mention query (after an @).
 * Returns the query string and start index, or null if not in a mention context.
 */
export function getActiveMentionQuery(
  text: string,
  cursorPos: number
): { query: string; startIndex: number } | null {
  // Look backwards from cursor for an @ that starts a mention
  const textBeforeCursor = text.slice(0, cursorPos);

  // Find the last @ that isn't part of an already-completed mention
  const lastAtIndex = textBeforeCursor.lastIndexOf("@");
  if (lastAtIndex === -1) return null;

  // The @ must be at start of text or preceded by whitespace
  if (lastAtIndex > 0 && !/\s/.test(textBeforeCursor[lastAtIndex - 1])) {
    return null;
  }

  // Check if this @ is inside a completed mention (e.g. @[name](uuid))
  // by looking for a closing ](uuid) after this @
  const afterAt = text.slice(lastAtIndex);
  const completedMentionMatch = afterAt.match(/^@\[[^\]]+\]\([a-f0-9-]+\)/);
  if (completedMentionMatch) {
    // This @ is part of a completed mention — not an active query
    return null;
  }

  const query = textBeforeCursor.slice(lastAtIndex + 1);

  // If query contains a newline or is too long, it's not a real mention
  if (query.includes("\n") || query.length > 50) return null;

  return { query, startIndex: lastAtIndex };
}

/**
 * Filter and sort community members by a mention query.
 */
export function filterMembers(
  members: { id: string; displayName: string }[],
  query: string,
  limit: number = 8
): { id: string; displayName: string }[] {
  if (!query) return members.slice(0, limit);

  const lower = query.toLowerCase();
  return members
    .filter((m) => m.displayName.toLowerCase().includes(lower))
    .sort((a, b) => {
      // Prefer prefix matches
      const aStarts = a.displayName.toLowerCase().startsWith(lower) ? 0 : 1;
      const bStarts = b.displayName.toLowerCase().startsWith(lower) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.displayName.localeCompare(b.displayName);
    })
    .slice(0, limit);
}

/**
 * Check if a message text contains a mention of a specific user.
 */
export function hasMentionOf(text: string, userId: string): boolean {
  const regex = new RegExp(`@\\[[^\\]]+\\]\\(${userId}\\)`);
  return regex.test(text);
}
