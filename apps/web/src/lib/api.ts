import { useAuthStore } from "../stores/auth";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Get token from auth store
  const token = useAuthStore.getState().token;

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  // Add authorization header if token exists
  if (token) {
    (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }

  return response.json();
}

// Auth
export const api = {
  auth: {
    register: (data: {
      email: string;
      password: string;
      displayName: string;
      identityKeyPublic: string;
      signedPreKeyPublic: string;
      signedPreKeySignature: string;
      preKeys: { keyId: string; publicKey: string }[];
    }) =>
      request<{ user: { id: string; email: string; displayName: string }; token: string }>(
        "/auth/register",
        {
          method: "POST",
          body: JSON.stringify(data),
        }
      ),

    login: (email: string, password: string) =>
      request<{ user: { id: string; email: string; displayName: string }; token: string }>(
        "/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ email, password }),
        }
      ),

    getUserKeys: (userId: string) =>
      request<{
        identityKey: string;
        signedPreKey: { publicKey: string; signature: string };
        preKey: { keyId: string; publicKey: string } | null;
      }>(`/auth/users/${userId}/keys`),

    updateKeys: (
      data: {
        identityKeyPublic: string;
        signedPreKeyPublic: string;
        signedPreKeySignature: string;
        preKeys: { keyId: string; publicKey: string }[];
      },
      token: string
    ) =>
      fetch(`${API_BASE}/auth/keys`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      }).then((res) => {
        if (!res.ok) throw new Error("Failed to update keys");
        return res.json();
      }),
  },

  communities: {
    create: (data: { name: string; userId: string }) =>
      request<{ community: { id: string; name: string; inviteCode: string } }>("/communities", {
        method: "POST",
        body: JSON.stringify(data),
      }),

    list: (userId: string) =>
      request<{ communities: { id: string; name: string; inviteCode: string }[] }>(
        `/communities/user/${userId}`
      ),

    get: (communityId: string) =>
      request<{
        community: { id: string; name: string; inviteCode: string };
        channels: { id: string; communityId: string; name: string }[];
        members: { id: string; displayName: string; avatarUrl?: string }[];
      }>(`/communities/${communityId}`),

    join: (inviteCode: string, userId: string) =>
      request<{ community: { id: string; name: string; inviteCode: string } }>(
        "/communities/join",
        {
          method: "POST",
          body: JSON.stringify({ inviteCode, userId }),
        }
      ),
  },

  channels: {
    create: (data: { communityId: string; name: string }) =>
      request<{ channel: { id: string; communityId: string; name: string } }>("/channels", {
        method: "POST",
        body: JSON.stringify(data),
      }),

    getSenderKeys: (channelId: string, userId: string) =>
      request<{
        senderKeys: {
          userId: string;
          distributionId: string;
          encryptedKey: string;
          senderPublicKey?: string;
        }[];
      }>(`/channels/${channelId}/sender-keys/${userId}`),

    getSenderKeyOwners: (channelId: string) =>
      request<{ senderKeyOwners: { userId: string; senderPublicKey?: string | null }[] }>(
        `/channels/${channelId}/sender-keys/owners`
      ),

    distributeSenderKey: (data: {
      channelId: string;
      userId: string;
      distributionId: string;
      senderPublicKey?: string;
      encryptedKeys: { forUserId: string; encryptedKey: string }[];
    }) =>
      request<{ success: boolean }>("/channels/sender-keys", {
        method: "POST",
        body: JSON.stringify(data),
      }),

    getPendingKeyRequests: () =>
      request<{
        pendingRequests: {
          id: string;
          channelId: string;
          requestingUserId: string;
          createdAt: string;
        }[];
      }>("/channels/pending-key-requests"),

    deletePendingKeyRequest: (requestId: string) =>
      request<{ success: boolean }>(`/channels/pending-key-requests/${requestId}`, {
        method: "DELETE",
      }),

    getMembers: (channelId: string) =>
      request<{ members: { id: string; displayName: string }[] }>(
        `/channels/${channelId}/members`
      ),
  },

  messages: {
    list: (channelId: string, cursor?: string) =>
      request<{
        messages: {
          id: string;
          channelId: string;
          senderId: string;
          ciphertext: string;
          createdAt: string;
        }[];
        nextCursor: string | null;
      }>(`/messages/channel/${channelId}${cursor ? `?cursor=${cursor}` : ""}`),

    getReplies: (messageId: string) =>
      request<{
        replies: {
          id: string;
          channelId: string;
          senderId: string;
          ciphertext: string;
          replyToId: string;
          createdAt: string;
        }[];
      }>(`/messages/${messageId}/replies`),
  },

  files: {
    upload: (encryptedBlob: Blob, channelId: string, iv: string) => {
      const formData = new FormData();
      formData.append("file", encryptedBlob);
      formData.append("channelId", channelId);
      formData.append("iv", iv);

      const token = useAuthStore.getState().token;
      return fetch(`${API_BASE}/files/upload`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      }).then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Upload failed" }));
          throw new Error(err.error || "Upload failed");
        }
        return res.json() as Promise<{ fileId: string }>;
      });
    },

    download: async (fileId: string): Promise<{ blob: Blob; iv: string }> => {
      const token = useAuthStore.getState().token;
      const res = await fetch(`${API_BASE}/files/${fileId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Download failed");
      const iv = res.headers.get("X-File-IV") || "";
      const blob = await res.blob();
      return { blob, iv };
    },
  },

  polls: {
    vote: (messageId: string, optionIndex: number, exclusive?: boolean) =>
      request<{ success: boolean }>("/polls/vote", {
        method: "POST",
        body: JSON.stringify({ messageId, optionIndex, exclusive }),
      }),

    removeVote: (messageId: string, optionIndex: number) =>
      request<{ success: boolean }>("/polls/vote", {
        method: "DELETE",
        body: JSON.stringify({ messageId, optionIndex }),
      }),

    getResults: (messageId: string) =>
      request<{
        votes: { optionIndex: number; count: number; userIds: string[] }[];
      }>(`/polls/${messageId}/results`),
  },

  emojis: {
    list: (communityId: string) =>
      request<{
        emojis: { id: string; name: string; fileUrl: string; animated: boolean }[];
      }>(`/emojis/community/${communityId}`),

    create: (data: {
      communityId: string;
      name: string;
      fileUrl: string;
      animated: boolean;
      uploadedBy: string;
    }) =>
      request<{ emoji: { id: string; name: string; fileUrl: string; animated: boolean } }>(
        "/emojis",
        {
          method: "POST",
          body: JSON.stringify(data),
        }
      ),

    uploadImage: (file: File, communityId: string) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("communityId", communityId);

      const token = useAuthStore.getState().token;
      return fetch(`${API_BASE}/files/emoji-upload`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      }).then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Upload failed" }));
          throw new Error(err.error || "Upload failed");
        }
        return res.json() as Promise<{ fileUrl: string }>;
      });
    },

    delete: (emojiId: string) =>
      request<{ success: boolean }>(`/emojis/${emojiId}`, { method: "DELETE" }),
  },
};
