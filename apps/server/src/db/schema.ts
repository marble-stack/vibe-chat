import { pgTable, text, timestamp, uuid, boolean, index } from "drizzle-orm/pg-core";

// Users
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique().notNull(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  avatarUrl: text("avatar_url"),
  // Signal Protocol keys (stored as base64)
  identityKeyPublic: text("identity_key_public"),
  signedPreKeyPublic: text("signed_prekey_public"),
  signedPreKeySignature: text("signed_prekey_signature"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// One-time prekeys for Signal Protocol
export const preKeys = pgTable("prekeys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  keyId: text("key_id").notNull(),
  publicKey: text("public_key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("prekeys_user_idx").on(table.userId),
}));

// Communities (like Discord servers)
export const communities = pgTable("communities", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  iconUrl: text("icon_url"),
  inviteCode: text("invite_code").unique().notNull(),
  createdBy: uuid("created_by").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Community members
export const communityMembers = pgTable("community_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id").references(() => communities.id).notNull(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
}, (table) => ({
  communityIdx: index("community_members_community_idx").on(table.communityId),
  userIdx: index("community_members_user_idx").on(table.userId),
}));

// Channels within communities
export const channels = pgTable("channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id").references(() => communities.id).notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  communityIdx: index("channels_community_idx").on(table.communityId),
}));

// Sender keys for channel encryption
export const senderKeys = pgTable("sender_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelId: uuid("channel_id").references(() => channels.id).notNull(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  distributionId: text("distribution_id").notNull(),
  // Encrypted sender key (encrypted to each recipient)
  encryptedKey: text("encrypted_key").notNull(),
  forUserId: uuid("for_user_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  channelUserIdx: index("sender_keys_channel_user_idx").on(table.channelId, table.forUserId),
}));

// Messages (encrypted)
export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelId: uuid("channel_id").references(() => channels.id).notNull(),
  senderId: uuid("sender_id").references(() => users.id).notNull(),
  ciphertext: text("ciphertext").notNull(),
  replyToId: uuid("reply_to_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  channelIdx: index("messages_channel_idx").on(table.channelId),
  createdAtIdx: index("messages_created_at_idx").on(table.createdAt),
}));

// Custom emojis
export const emojis = pgTable("emojis", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id").references(() => communities.id).notNull(),
  name: text("name").notNull(),
  fileUrl: text("file_url").notNull(),
  animated: boolean("animated").default(false).notNull(),
  uploadedBy: uuid("uploaded_by").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  communityIdx: index("emojis_community_idx").on(table.communityId),
}));

// Message reactions
export const reactions = pgTable("reactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  messageIdx: index("reactions_message_idx").on(table.messageId),
  userMessageEmojiIdx: index("reactions_user_message_emoji_idx").on(table.userId, table.messageId, table.emoji),
}));
