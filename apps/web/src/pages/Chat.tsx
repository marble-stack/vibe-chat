import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import { useChatStore } from "../stores/chat";
import { api } from "../lib/api";
import { wsClient } from "../lib/websocket";
import {
  decryptChannelMessage,
  distributeChannelKey,
  tryFetchChannelKey,
  isDecryptionError,
  prefetchChannelKeysByIds,
} from "../lib/channelCrypto";
import { uploadKeyBackupWithRetry } from "../lib/crypto";
import { getChannelKey, getIdentityKeys, getAllChannelKeys, getFullIdentityKeysForBackup } from "../lib/keyStore";
import { logger } from "../lib/logger";
import { Sidebar } from "../components/Sidebar";
import { ChannelList } from "../components/ChannelList";
import { MessageList } from "../components/MessageList";
import { MessageInput } from "../components/MessageInput";
import { MemberList } from "../components/MemberList";
import { KeyRecoveryBanner } from "../components/KeyRecoveryBanner";
import { KeyBackupWarning } from "../components/KeyBackupWarning";
import { ThreadPanel } from "../components/ThreadPanel";
import { SearchPanel } from "../components/SearchPanel";
import { WelcomeSplash } from "../components/WelcomeSplash";
import { ActivitySplash } from "../components/ActivitySplash";
import {
  requestNotificationPermission,
  showMessageNotification,
} from "../lib/notifications";

export function Chat() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const logout = useAuthStore((state) => state.logout);
  const hasHydrated = useAuthStore((state) => state._hasHydrated);
  const {
    activeCommunityId,
    activeChannelId,
    members,
    setCommunities,
    setChannels,
    setMembers,
    setCustomEmojis,
    addMessage,
    addMemberIfMissing,
    addMemberToCommunity,
    setTypingUser,
    setOnlineUsers,
    setUserOnline,
    updateMessage,
    deleteMessage,
    addReaction,
    removeReaction,
    activeThreadId,
    updatePollVote,
    incrementUnread,
    markChannelRead,
    isSearchOpen,
    bumpKeySyncVersion,
  } = useChatStore();

  // Splash page state
  const [showActivitySplash, setShowActivitySplash] = useState(false);
  const [splashDismissed, setSplashDismissed] = useState(false);
  const [communitiesLoaded, setCommunitiesLoaded] = useState(false);

  // Ref to track current members for the WebSocket handler
  const membersRef = useRef(members);
  const activeCommunityRef = useRef(activeCommunityId);
  const activeChannelRef = useRef(activeChannelId);

  useEffect(() => {
    membersRef.current = members;
    activeCommunityRef.current = activeCommunityId;
    activeChannelRef.current = activeChannelId;
  }, [members, activeCommunityId, activeChannelId]);

  // Load communities on mount (wait for auth store to rehydrate first)
  // After loading, validate and restore the last-visited community/channel from localStorage
  useEffect(() => {
    if (!user || !hasHydrated) return;

    const loadCommunities = async () => {
      try {
        const { communities } = await api.communities.list(user.id);
        setCommunities(communities);
        setCommunitiesLoaded(true);

        if (communities.length === 0) {
          // New user with no communities — WelcomeSplash will show
          return;
        }

        // Show activity splash for returning users (don't auto-select community)
        if (!splashDismissed) {
          setShowActivitySplash(true);
          return;
        }

        // If splash was already dismissed, restore last-visited community
        const { activeCommunityId: savedCommunityId } = useChatStore.getState();
        if (savedCommunityId && communities.some((c) => c.id === savedCommunityId)) {
          useChatStore.getState().setActiveCommunity(savedCommunityId);
        } else if (communities.length > 0) {
          useChatStore.getState().setActiveCommunity(communities[0].id);
        }
      } catch (err) {
        logger.error("Failed to load communities:", err);
        setTimeout(async () => {
          try {
            const { communities } = await api.communities.list(user.id);
            setCommunities(communities);
            setCommunitiesLoaded(true);

            if (communities.length > 0 && !splashDismissed) {
              setShowActivitySplash(true);
            }
          } catch (retryErr) {
            logger.error("Failed to load communities on retry:", retryErr);
          }
        }, 500);
      }
    };

    loadCommunities();
  }, [user, hasHydrated, setCommunities]);

  // Request notification permission on mount
  useEffect(() => {
    if (user) {
      requestNotificationPermission();
    }
  }, [user]);

  // Re-attempt key backup on mount if previous backup failed
  useEffect(() => {
    if (!user || !token || !hasHydrated) return;

    const { keyBackupStatus, setKeyBackupStatus, setLastBackupAt } = useAuthStore.getState();
    if (keyBackupStatus === "success") return;

    const attemptBackup = async () => {
      const identityKeys = await getIdentityKeys();
      if (!identityKeys) return;

      // We need the full IdentityKeys object - reconstruct from stored data
      // The password is needed but we don't store it. For re-attempts we can only
      // succeed if the backup was never uploaded (no password needed for check).
      // For now, check if a backup already exists on server.
      try {
        const backup = await api.auth.getKeyBackup(token);
        if (backup.encryptedKeyBackup && backup.salt) {
          // Backup exists on server — mark as success
          setKeyBackupStatus("success");
          setLastBackupAt(Date.now());
        }
        // If no backup exists, we can't re-upload without the password.
        // The KeyBackupWarning banner will show with a "retry" option.
      } catch {
        // Network error — leave status as-is, will retry next mount
      }
    };

    attemptBackup();
  }, [user, token, hasHydrated]);

  // Proactively fetch channel keys on login to minimize "[Syncing keys...]"
  // Uses channel IDs already loaded into the store to avoid duplicate API calls.
  useEffect(() => {
    if (!user || !hasHydrated) return;

    // Wait briefly for community/channel data to load into the store
    const timer = setTimeout(async () => {
      try {
        // Collect all channel IDs from the store (already fetched by loadCommunities effect)
        const storeChannels = useChatStore.getState().channels;
        const allChannelIds: string[] = [];
        for (const communityChannels of Object.values(storeChannels)) {
          for (const ch of communityChannels) {
            allChannelIds.push(ch.id);
          }
        }

        if (allChannelIds.length === 0) return;

        const fetchedChannelIds = await prefetchChannelKeysByIds(allChannelIds, user.id);
        for (const channelId of fetchedChannelIds) {
          bumpKeySyncVersion(channelId);
        }

        // Re-upload backup with channel keys included so future logins restore them
        const sessionPassword = useAuthStore.getState().sessionPassword;
        if (sessionPassword && token) {
          const fullKeys = await getFullIdentityKeysForBackup();
          const channelKeys = await getAllChannelKeys();
          if (fullKeys && Object.keys(channelKeys).length > 0) {
            uploadKeyBackupWithRetry(fullKeys, sessionPassword, token, channelKeys)
              .then(() => useAuthStore.getState().setSessionPassword(null));
          }
        }
      } catch (err) {
        logger.error("Channel key prefetch failed:", err);
      }
    }, 2000); // Wait 2s for store to populate from community loading effects

    return () => clearTimeout(timer);
  }, [user, hasHydrated, bumpKeySyncVersion]);

  // Process pending key requests on login (for offline key sync)
  // When a key holder comes online, they should redistribute keys to users who requested while offline
  useEffect(() => {
    if (!user || !hasHydrated) return;

    const processPendingRequests = async () => {
      try {
        const { pendingRequests } = await api.channels.getPendingKeyRequests();

        if (pendingRequests.length === 0) return;

        logger.debug(`Processing ${pendingRequests.length} pending key requests`);

        // Group requests by channel
        const requestsByChannel = new Map<string, typeof pendingRequests>();
        for (const req of pendingRequests) {
          const existing = requestsByChannel.get(req.channelId) || [];
          existing.push(req);
          requestsByChannel.set(req.channelId, existing);
        }

        // Process each channel's requests
        for (const [channelId, requests] of requestsByChannel) {
          const channelKey = await getChannelKey(channelId);
          if (!channelKey) {
            logger.debug(`No local key for channel ${channelId}, skipping`);
            continue;
          }

          // Get all requesting user IDs for this channel
          const requestingUserIds = requests.map((r) => r.requestingUserId);

          // We need member info for key distribution - fetch it for these users
          // Create minimal member objects with the requesting user IDs
          const membersForDistribution = [
            { id: user.id, displayName: user.displayName || "Me" },
            ...requestingUserIds.map((id) => ({ id, displayName: "Unknown" })),
          ];

          // Redistribute the key to all members
          try {
            await distributeChannelKey(channelId, channelKey, membersForDistribution, user.id);
            logger.debug(
              `Redistributed key for channel ${channelId} to ${requestingUserIds.length} users`
            );

            // Delete the fulfilled requests
            for (const req of requests) {
              try {
                await api.channels.deletePendingKeyRequest(req.id);
              } catch {
                // Ignore deletion errors - request might have been deleted by another key holder
              }
            }
          } catch (err) {
            logger.error(`Failed to redistribute key for channel ${channelId}:`, err);
          }
        }
      } catch (err) {
        logger.error("Failed to process pending key requests:", err);
      }
    };

    // Run immediately (WebSocket may already be connected from a prior session)
    processPendingRequests();
    // Run again after 5 seconds to cover the case where WebSocket wasn't ready yet
    const timeoutId = setTimeout(processPendingRequests, 5000);
    return () => clearTimeout(timeoutId);
  }, [user, hasHydrated]);

  // Load community details when active community changes
  // Validates and restores the saved channel from localStorage
  useEffect(() => {
    if (!activeCommunityId) return;

    api.communities.get(activeCommunityId).then(({ channels, members }) => {
      setChannels(activeCommunityId, channels);
      setMembers(activeCommunityId, members);

      // Fetch custom emojis for this community
      api.emojis.list(activeCommunityId).then(({ emojis }) => {
        setCustomEmojis(activeCommunityId, emojis);
      }).catch(() => {
        // Emoji fetch is non-critical
      });

      // Restore last-visited channel if valid, otherwise select first channel
      const { activeChannelId: savedChannelId } = useChatStore.getState();
      if (savedChannelId && channels.some((c) => c.id === savedChannelId)) {
        // Saved channel exists in this community — keep it selected
        useChatStore.getState().setActiveChannel(savedChannelId);
      } else if (channels.length > 0) {
        // No saved channel — auto-select first channel (mobile convenience)
        useChatStore.getState().setActiveChannel(channels[0].id);
      }
    });
  }, [activeCommunityId, setChannels, setMembers, setCustomEmojis]);

  // Connect WebSocket
  useEffect(() => {
    if (!user || !token) return;

    wsClient.connect(user.id, token);

    // Handle incoming messages
    const handleNewMessage = async (msg: { payload: Record<string, unknown> }) => {
      const payload = msg.payload as {
        id: string;
        channelId: string;
        senderId: string;
        senderDisplayName?: string;
        ciphertext: string;
        replyToId?: string;
        isThreadReply?: boolean;
        clientId?: string;
        createdAt: string;
      };

      // Add sender to members if we have their info and they're not already known
      if (payload.senderDisplayName) {
        addMemberIfMissing(payload.senderId, payload.senderDisplayName);
      }

      // If this is our own message echoed back, reconcile with the optimistic message
      // (skip decryption — we already have the plaintext from the optimistic insert)
      if (user && payload.senderId === user.id && payload.clientId) {
        addMessage({
          id: payload.id,
          clientId: payload.clientId,
          channelId: payload.channelId,
          senderId: payload.senderId,
          ciphertext: payload.ciphertext,
          replyToId: payload.replyToId,
          isThreadReply: payload.isThreadReply,
          createdAt: payload.createdAt,
          pending: false,
          sendFailed: false,
        });
        return;
      }

      // Get current community members for decryption
      const currentCommunityId = activeCommunityRef.current;
      let currentMembers = currentCommunityId ? membersRef.current[currentCommunityId] || [] : [];

      // Ensure current user is in members list for key distribution/retrieval
      if (user && !currentMembers.some((m) => m.id === user.id)) {
        currentMembers = [
          ...currentMembers,
          { id: user.id, displayName: user.displayName || "Me" },
        ];
      }

      // Decrypt the message
      let plaintext = payload.ciphertext;
      let decryptionFailed = false;
      try {
        if (user) {
          plaintext = await decryptChannelMessage(
            payload.channelId,
            payload.ciphertext,
            currentMembers,
            user.id,
            payload.senderId
          );
          if (isDecryptionError(plaintext)) {
            decryptionFailed = true;
          }
        }
      } catch (err) {
        logger.error("Failed to decrypt message:", err);
        decryptionFailed = true;
      }

      addMessage({
        id: payload.id,
        channelId: payload.channelId,
        senderId: payload.senderId,
        ciphertext: payload.ciphertext,
        plaintext,
        decryptionFailed,
        replyToId: payload.replyToId,
        isThreadReply: payload.isThreadReply,
        createdAt: payload.createdAt,
      });

      // Increment unread count if message is for a non-active channel
      if (payload.channelId !== activeChannelRef.current) {
        incrementUnread(payload.channelId);
      }

      // Show desktop notification when tab is not focused
      if (!document.hasFocus() && user && payload.senderId !== user.id) {
        const senderName = payload.senderDisplayName || "Someone";
        const preview = decryptionFailed ? "New message" : (plaintext || "New message");
        // Try to parse as structured content for better preview
        let displayPreview = preview;
        try {
          const parsed = JSON.parse(preview);
          if (parsed.type === "file") displayPreview = `Sent a file: ${parsed.filename}`;
          else if (parsed.type === "poll") displayPreview = `Created a poll: ${parsed.question}`;
        } catch {
          // Not JSON, use as-is
        }
        const channels = useChatStore.getState().channels;
        const currentCommunityId = activeCommunityRef.current;
        const channelList = currentCommunityId ? channels[currentCommunityId] || [] : [];
        const channel = channelList.find((c) => c.id === payload.channelId);
        showMessageNotification(senderName, displayPreview, channel?.name || "channel");
      }
    };

    // Handle typing indicators
    const handleTypingUpdate = (msg: { payload: Record<string, unknown> }) => {
      const { channelId, userId, isTyping } = msg.payload as {
        channelId: string;
        userId: string;
        isTyping: boolean;
      };
      setTypingUser(channelId, userId, isTyping);
    };

    // Handle presence list (initial online users when joining a community)
    const handlePresenceList = (msg: { payload: Record<string, unknown> }) => {
      const { communityId, onlineUserIds } = msg.payload as {
        communityId: string;
        onlineUserIds: string[];
      };
      setOnlineUsers(communityId, onlineUserIds);
    };

    // Handle presence update (user came online/offline)
    const handlePresenceUpdate = (msg: { payload: Record<string, unknown> }) => {
      const { communityId, userId, isOnline } = msg.payload as {
        communityId: string;
        userId: string;
        isOnline: boolean;
      };
      setUserOnline(communityId, userId, isOnline);
    };

    // Handle message edited
    const handleMessageEdited = async (msg: { payload: Record<string, unknown> }) => {
      const { id, channelId, ciphertext, editedAt } = msg.payload as {
        id: string;
        channelId: string;
        ciphertext: string;
        editedAt: string;
      };

      // Get current community members for decryption
      const currentCommunityId = activeCommunityRef.current;
      let currentMembers = currentCommunityId ? membersRef.current[currentCommunityId] || [] : [];

      // Ensure current user is in members list for key distribution/retrieval
      if (user && !currentMembers.some((m) => m.id === user.id)) {
        currentMembers = [
          ...currentMembers,
          { id: user.id, displayName: user.displayName || "Me" },
        ];
      }

      // Decrypt the updated message
      let plaintext = ciphertext;
      let decryptionFailed = false;
      try {
        if (user) {
          plaintext = await decryptChannelMessage(channelId, ciphertext, currentMembers, user.id);
          if (isDecryptionError(plaintext)) {
            decryptionFailed = true;
          }
        }
      } catch (err) {
        logger.error("Failed to decrypt edited message:", err);
        decryptionFailed = true;
      }

      updateMessage(channelId, id, { ciphertext, plaintext, decryptionFailed, editedAt });
    };

    // Handle message deleted
    const handleMessageDeleted = (msg: { payload: Record<string, unknown> }) => {
      const { id, channelId } = msg.payload as {
        id: string;
        channelId: string;
      };
      deleteMessage(channelId, id);
    };

    // Handle reaction added
    const handleReactionAdded = (msg: { payload: Record<string, unknown> }) => {
      const { reactionId, messageId, userId, emoji } = msg.payload as {
        reactionId: string;
        messageId: string;
        userId: string;
        emoji: string;
      };
      addReaction(messageId, reactionId, userId, emoji);
    };

    // Handle reaction removed
    const handleReactionRemoved = (msg: { payload: Record<string, unknown> }) => {
      const { messageId, userId, emoji } = msg.payload as {
        messageId: string;
        userId: string;
        emoji: string;
      };
      removeReaction(messageId, userId, emoji);
    };

    // Handle auth failure - force re-login
    const handleAuthFailed = () => {
      logger.warn("WebSocket authentication failed - forcing re-login");
      // Only clear session - preserve identity keys so encryption continues working after re-login
      logout();
      navigate("/login");
    };

    // Handle key redistribution request - another user needs our channel key
    const handleKeyRequested = async (msg: { payload: Record<string, unknown> }) => {
      const { channelId, requestingUserId } = msg.payload as {
        channelId: string;
        requestingUserId: string;
      };

      logger.debug(`Key redistribution requested by ${requestingUserId} for channel ${channelId}`);

      if (!user) return;

      // Get our local channel key
      const channelKey = await getChannelKey(channelId);
      if (!channelKey) {
        logger.debug("No local channel key to redistribute");
        return;
      }

      // Get current community members including the requester
      const currentCommunityId = activeCommunityRef.current;
      let currentMembers = currentCommunityId ? membersRef.current[currentCommunityId] || [] : [];

      // Ensure the requester is in the list
      if (!currentMembers.some((m) => m.id === requestingUserId)) {
        currentMembers = [...currentMembers, { id: requestingUserId, displayName: "Unknown" }];
      }

      // Ensure current user is in members list
      if (!currentMembers.some((m) => m.id === user.id)) {
        currentMembers = [
          ...currentMembers,
          { id: user.id, displayName: user.displayName || "Me" },
        ];
      }

      // Redistribute the key to all members (including the requester)
      try {
        await distributeChannelKey(channelId, channelKey, currentMembers, user.id);
        logger.debug(`Redistributed key to ${currentMembers.length} members`);
      } catch (err) {
        logger.error("Failed to redistribute key:", err);
      }
    };

    // Handle key available notification - bump keySyncVersion to trigger re-decryption in MessageList
    const handleKeyAvailable = async (msg: { payload: Record<string, unknown> }) => {
      const { channelId } = msg.payload as { channelId: string; fromUserId: string };

      if (!user) return;

      logger.debug(`Key available for channel ${channelId}, bumping keySyncVersion`);

      // First, try to fetch and store the key so it's available for decryption
      await tryFetchChannelKey(channelId, user.id);

      // Bump the version counter - MessageList watches this and re-decrypts failed messages
      bumpKeySyncVersion(channelId);
    };

    // Handle poll voted
    const handlePollVoted = (msg: { payload: Record<string, unknown> }) => {
      const { messageId, userId, optionIndex, action } = msg.payload as {
        messageId: string;
        channelId: string;
        userId: string;
        optionIndex: number;
        action: "add" | "remove";
      };
      updatePollVote(messageId, userId, optionIndex, action);
    };

    // Handle key request sent acknowledgment - retry if no key holder was online
    const handleKeyRequestSent = (msg: { payload: Record<string, unknown> }) => {
      const { channelId, sentToOnlineKeyHolder } = msg.payload as {
        channelId: string;
        sentToOnlineKeyHolder: boolean;
      };

      if (!sentToOnlineKeyHolder) {
        // No key holder was online — retry after 10 seconds in case someone comes online
        logger.debug(`No online key holder for ${channelId}, retrying in 10s`);
        setTimeout(() => {
          if (user) {
            wsClient.requestKey(channelId, user.id);
          }
        }, 10000);
      }
    };

    // Handle new member joining a community - update local member list
    const handleMemberJoined = (msg: { payload: Record<string, unknown> }) => {
      const { communityId, member } = msg.payload as {
        communityId: string;
        member: { id: string; displayName: string; avatarUrl?: string };
      };
      logger.debug(`New member ${member.displayName} joined community ${communityId}`);
      addMemberToCommunity(communityId, member);
    };

    wsClient.on("message:new", handleNewMessage);
    wsClient.on("auth:failed", handleAuthFailed);
    wsClient.on("typing:update", handleTypingUpdate);
    wsClient.on("presence:list", handlePresenceList);
    wsClient.on("presence:update", handlePresenceUpdate);
    wsClient.on("message:edited", handleMessageEdited);
    wsClient.on("message:deleted", handleMessageDeleted);
    wsClient.on("reaction:added", handleReactionAdded);
    wsClient.on("reaction:removed", handleReactionRemoved);
    wsClient.on("key:requested", handleKeyRequested);
    wsClient.on("key:available", handleKeyAvailable);
    wsClient.on("key:request:sent", handleKeyRequestSent);
    wsClient.on("member:joined", handleMemberJoined);
    wsClient.on("poll:voted", handlePollVoted);

    return () => {
      wsClient.off("message:new", handleNewMessage);
      wsClient.off("auth:failed", handleAuthFailed);
      wsClient.off("typing:update", handleTypingUpdate);
      wsClient.off("presence:list", handlePresenceList);
      wsClient.off("presence:update", handlePresenceUpdate);
      wsClient.off("message:edited", handleMessageEdited);
      wsClient.off("message:deleted", handleMessageDeleted);
      wsClient.off("reaction:added", handleReactionAdded);
      wsClient.off("reaction:removed", handleReactionRemoved);
      wsClient.off("key:requested", handleKeyRequested);
      wsClient.off("key:available", handleKeyAvailable);
      wsClient.off("key:request:sent", handleKeyRequestSent);
      wsClient.off("member:joined", handleMemberJoined);
      wsClient.off("poll:voted", handlePollVoted);
      wsClient.disconnect();
    };
  }, [
    user,
    token,
    logout,
    navigate,
    addMessage,
    setTypingUser,
    setOnlineUsers,
    setUserOnline,
    updateMessage,
    deleteMessage,
    addReaction,
    removeReaction,
    addMemberIfMissing,
    addMemberToCommunity,
    updatePollVote,
    incrementUnread,
    bumpKeySyncVersion,
  ]);

  // Join active community for presence updates
  useEffect(() => {
    if (activeCommunityId) {
      wsClient.joinCommunity(activeCommunityId);
    }
  }, [activeCommunityId]);

  // Join active channel and mark as read
  useEffect(() => {
    if (activeChannelId) {
      wsClient.joinChannel(activeChannelId);
      markChannelRead(activeChannelId);
    }
  }, [activeChannelId, markChannelRead]);

  // Polling fallback for key sync with exponential backoff
  useEffect(() => {
    if (!user || !activeChannelId) return;

    let pollDelay = 5000; // Start at 5s
    const maxDelay = 60000; // Cap at 60s
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const pollForKeys = async () => {
      if (cancelled) return;

      // Check if there are any messages stuck in syncing state for the active channel
      const channelMsgs = useChatStore.getState().messages[activeChannelId] || [];
      const hasSyncingMessages = channelMsgs.some(
        (m) => isDecryptionError(m.plaintext) || m.decryptionFailed
      );

      if (!hasSyncingMessages) {
        // No syncing messages — reset backoff and check again later
        pollDelay = 5000;
        if (!cancelled) timeoutId = setTimeout(pollForKeys, pollDelay);
        return;
      }

      // Try to fetch the key from server (in case key owner came online and distributed)
      const keyFound = await tryFetchChannelKey(activeChannelId, user.id);
      if (keyFound) {
        logger.debug("Polling found new key");
      }

      // If no key found, re-request via WebSocket
      if (!keyFound) {
        const localKey = await getChannelKey(activeChannelId);
        if (!localKey) {
          wsClient.requestKey(activeChannelId, user.id);
          logger.debug("Re-requesting key via WebSocket");
        }
      }

      // Always try to re-decrypt if we have syncing messages
      const currentCommunityId = activeCommunityRef.current;
      let currentMembers = currentCommunityId ? membersRef.current[currentCommunityId] || [] : [];

      if (!currentMembers.some((m) => m.id === user.id)) {
        currentMembers = [
          ...currentMembers,
          { id: user.id, displayName: user.displayName || "Me" },
        ];
      }

      const failedMsgs =
        useChatStore
          .getState()
          .messages[activeChannelId]?.filter(
            (m) => isDecryptionError(m.plaintext) || m.decryptionFailed
          ) || [];

      let allResolved = true;
      for (const failedMsg of failedMsgs) {
        try {
          const plaintext = await decryptChannelMessage(
            activeChannelId,
            failedMsg.ciphertext,
            currentMembers,
            user.id,
            failedMsg.senderId
          );
          if (!isDecryptionError(plaintext)) {
            updateMessage(activeChannelId, failedMsg.id, { plaintext, decryptionFailed: false });
          } else {
            allResolved = false;
          }
        } catch {
          allResolved = false;
        }
      }

      // If all resolved, reset backoff; otherwise increase delay
      if (allResolved) {
        pollDelay = 5000;
      } else {
        pollDelay = Math.min(pollDelay * 2, maxDelay);
      }

      if (!cancelled) timeoutId = setTimeout(pollForKeys, pollDelay);
    };

    // Poll immediately on channel change
    pollForKeys();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [user, activeChannelId, updateMessage]);

  return (
    <div className="h-screen-safe flex bg-background-primary overflow-hidden">
      {/* Community sidebar */}
      <Sidebar />

      {/* Channel list - hidden on mobile when chat is active */}
      <ChannelList showOnMobile={!activeChannelId} />

      {/* Main chat area - only show on mobile when channel is selected */}
      <div className={`flex-1 flex flex-col ${activeChannelId ? "flex" : "hidden md:flex"}`}>
        {/* Key recovery banner - shown when encryption keys are missing */}
        <KeyRecoveryBanner />
        {/* Key backup warning - shown when backup to server failed */}
        <KeyBackupWarning />

        {communitiesLoaded && useChatStore.getState().communities.length === 0 ? (
          <WelcomeSplash />
        ) : showActivitySplash && !splashDismissed ? (
          <ActivitySplash onDismiss={() => {
            setSplashDismissed(true);
            setShowActivitySplash(false);
            // Auto-select the last-visited or first community
            const { communities, activeCommunityId: current } = useChatStore.getState();
            if (!current && communities.length > 0) {
              const savedCommunityId = useChatStore.getState().activeCommunityId;
              if (savedCommunityId && communities.some((c) => c.id === savedCommunityId)) {
                useChatStore.getState().setActiveCommunity(savedCommunityId);
              } else {
                useChatStore.getState().setActiveCommunity(communities[0].id);
              }
            }
          }} />
        ) : activeChannelId ? (
          <>
            <MessageList />
            <MessageInput />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-text-muted">
            Select a channel to start chatting
          </div>
        )}
      </div>

      {/* Search panel */}
      {isSearchOpen && <SearchPanel />}

      {/* Thread panel */}
      {activeThreadId && <ThreadPanel />}

      {/* Member list */}
      {activeCommunityId && <MemberList />}
    </div>
  );
}
