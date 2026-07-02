import { db, communityMembers, channels, communities } from "../db/index.js";
import { eq, and } from "drizzle-orm";

/**
 * Check if a user is a member of a community
 */
export async function isUserInCommunity(userId: string, communityId: string): Promise<boolean> {
  const membership = await db.query.communityMembers.findFirst({
    where: and(eq(communityMembers.userId, userId), eq(communityMembers.communityId, communityId)),
  });

  return !!membership;
}

/**
 * Check if a user can access a channel (must be member of the channel's community)
 */
export async function canUserAccessChannel(userId: string, channelId: string): Promise<boolean> {
  // First, get the channel to find its community
  const channel = await db.query.channels.findFirst({
    where: eq(channels.id, channelId),
  });

  if (!channel) {
    return false;
  }

  // Then check if user is member of that community
  return isUserInCommunity(userId, channel.communityId);
}

/**
 * Check if a user is the owner (creator) of a community
 */
export async function isCommunityOwner(userId: string, communityId: string): Promise<boolean> {
  const community = await db.query.communities.findFirst({
    where: eq(communities.id, communityId),
  });

  return community?.createdBy === userId;
}

/**
 * Check if a user is the owner (creator) of the community a channel belongs to
 */
export async function isChannelCommunityOwner(
  userId: string,
  channelId: string
): Promise<boolean> {
  const channel = await db.query.channels.findFirst({
    where: eq(channels.id, channelId),
  });

  if (!channel) {
    return false;
  }

  return isCommunityOwner(userId, channel.communityId);
}

/**
 * Get the community ID for a channel
 */
export async function getChannelCommunityId(channelId: string): Promise<string | null> {
  const channel = await db.query.channels.findFirst({
    where: eq(channels.id, channelId),
  });

  return channel?.communityId ?? null;
}
