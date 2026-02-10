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
} from "../lib/channelCrypto";
import { getChannelKey } from "../lib/keyStore";
import { logger } from "../lib/logger";
import { Sidebar } from "../components/Sidebar";
import { ChannelList } from "../components/ChannelList";
import { MessageList } from "../components/MessageList";
import { MessageInput } from "../components/MessageInput";
import { MemberList } from "../components/MemberList";
import { KeyRecoveryBanner } from "../components/KeyRecoveryBanner";
import { ThreadPanel } from "../components/ThreadPanel";
import { SearchPanel } from "../components/SearchPanel";
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
  } = useChatStore();

  // Mobile navigation state
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);

  // Close mobile sidebar when clicking outside
  const handleBackdropClick = () => {
    setShowMobileSidebar(false);
  };

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

        // Restore last-visited community from localStorage
        const { activeCommunityId: savedCommunityId } = useChatStore.getState();
        if (savedCommunityId && communities.some((c) => c.id === savedCommunityId)) {
          // Community exists — select it (triggers channel load via the community effect)
          useChatStore.getState().setActiveCommunity(savedCommunityId);
        } else if (communities.length > 0) {
          // No saved community (or it was deleted) — auto-select the first one
          useChatStore.getState().setActiveCommunity(communities[0].id);
        }
      } catch (err) {
        logger.error("Failed to load communities:", err);
        // Retry once after a short delay (helps with mobile auth timing)
        setTimeout(async () => {
          try {
            const { communities } = await api.communities.list(user.id);
            setCommunities(communities);

            const { activeCommunityId: savedCommunityId } = useChatStore.getState();
            if (savedCommunityId && communities.some((c) => c.id === savedCommunityId)) {
              useChatStore.getState().setActiveCommunity(savedCommunityId);
            } else if (communities.length > 0) {
              useChatStore.getState().setActiveCommunity(communities[0].id);
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

    // Process after a short delay to let WebSocket connect first
    const timeoutId = setTimeout(processPendingRequests, 2000);
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

    // Handle key available notification - re-decrypt failed messages
    const handleKeyAvailable = async (msg: { payload: Record<string, unknown> }) => {
      const { channelId } = msg.payload as { channelId: string; fromUserId: string };

      if (!user) return;

      logger.debug(`Key available for channel ${channelId}`);

      // Get current messages for this channel
      const channelMsgs = useChatStore.getState().messages[channelId] || [];
      const failedMsgs = channelMsgs.filter(
        (m) => isDecryptionError(m.plaintext) || m.decryptionFailed
      );

      if (failedMsgs.length === 0) return;

      logger.debug(`Re-decrypting ${failedMsgs.length} failed messages`);

      // Get current community members for decryption
      const currentCommunityId = activeCommunityRef.current;
      let currentMembers = currentCommunityId ? membersRef.current[currentCommunityId] || [] : [];

      // Ensure current user is in members list
      if (!currentMembers.some((m) => m.id === user.id)) {
        currentMembers = [
          ...currentMembers,
          { id: user.id, displayName: user.displayName || "Me" },
        ];
      }

      // Re-decrypt each failed message
      for (const failedMsg of failedMsgs) {
        try {
          const plaintext = await decryptChannelMessage(
            channelId,
            failedMsg.ciphertext,
            currentMembers,
            user.id,
            failedMsg.senderId
          );
          if (!isDecryptionError(plaintext)) {
            updateMessage(channelId, failedMsg.id, { plaintext, decryptionFailed: false });
          }
        } catch {
          // Still can't decrypt, leave as is
        }
      }
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

  // Polling fallback for key sync when key owner might be offline
  useEffect(() => {
    if (!user || !activeChannelId) return;

    const pollForKeys = async () => {
      // Check if there are any messages stuck in syncing state for the active channel
      const channelMsgs = useChatStore.getState().messages[activeChannelId] || [];
      const hasSyncingMessages = channelMsgs.some(
        (m) => isDecryptionError(m.plaintext) || m.decryptionFailed
      );

      if (!hasSyncingMessages) return;

      // Try to fetch the key from server (in case key owner came online and distributed)
      // Returns true if a NEW key was fetched, false if key already existed or not found
      const keyFound = await tryFetchChannelKey(activeChannelId, user.id);
      if (keyFound) {
        logger.debug("Polling found new key");
      }

      // If no key found, re-request via WebSocket (server broadcasts to all online key holders)
      if (!keyFound) {
        const localKey = await getChannelKey(activeChannelId);
        if (!localKey) {
          // We don't have a local key and couldn't fetch one - request it
          // Server will broadcast to all online key holders
          wsClient.requestKey(activeChannelId, user.id);
          logger.debug("Re-requesting key via WebSocket");
        }
      }

      // Always try to re-decrypt if we have syncing messages
      // The key might have been stored by key:available handler (tryFetchChannelKey returns false if key exists)
      // Get current community members for decryption
      const currentCommunityId = activeCommunityRef.current;
      let currentMembers = currentCommunityId ? membersRef.current[currentCommunityId] || [] : [];

      // Ensure current user is in members list
      if (!currentMembers.some((m) => m.id === user.id)) {
        currentMembers = [
          ...currentMembers,
          { id: user.id, displayName: user.displayName || "Me" },
        ];
      }

      // Re-decrypt failed messages
      const failedMsgs =
        useChatStore
          .getState()
          .messages[activeChannelId]?.filter(
            (m) => isDecryptionError(m.plaintext) || m.decryptionFailed
          ) || [];

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
          }
        } catch {
          // Still can't decrypt
        }
      }
    };

    // Poll every 5 seconds
    const intervalId = setInterval(pollForKeys, 5000);

    // Also poll immediately on channel change
    pollForKeys();

    return () => clearInterval(intervalId);
  }, [user, activeChannelId, updateMessage]);

  return (
    <div className="h-screen-safe flex bg-background-primary overflow-hidden">
      {/* Mobile backdrop overlay */}
      {showMobileSidebar && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={handleBackdropClick} />
      )}

      {/* Community sidebar */}
      <Sidebar showMobile={showMobileSidebar} onClose={() => setShowMobileSidebar(false)} />

      {/* Channel list - hidden on mobile when chat is active */}
      <ChannelList
        showOnMobile={!activeChannelId}
        onOpenSidebar={() => setShowMobileSidebar(true)}
      />

      {/* Main chat area - only show on mobile when channel is selected */}
      <div className={`flex-1 flex flex-col ${activeChannelId ? "flex" : "hidden md:flex"}`}>
        {/* Key recovery banner - shown when encryption keys are missing */}
        <KeyRecoveryBanner />

        {activeChannelId ? (
          <>
            <MessageList onOpenSidebar={() => setShowMobileSidebar(true)} />
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
