import { create } from "zustand";
import { persist } from "zustand/middleware";

interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
}

export type KeyBackupStatus = "pending" | "success" | "failed";

interface AuthState {
  user: User | null;
  token: string | null;
  _hasHydrated: boolean;
  keyBackupStatus: KeyBackupStatus;
  lastBackupAt: number | null;
  sessionPassword: string | null;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  setAuth: (user: User, token: string) => void;
  logout: () => void;
  setHasHydrated: (state: boolean) => void;
  setKeyBackupStatus: (status: KeyBackupStatus) => void;
  setLastBackupAt: (timestamp: number) => void;
  setSessionPassword: (pw: string | null) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      _hasHydrated: false,
      keyBackupStatus: "pending" as KeyBackupStatus,
      lastBackupAt: null,
      sessionPassword: null,
      setUser: (user) => set({ user }),
      setToken: (token) => set({ token }),
      setAuth: (user, token) => set({ user, token }),
      logout: () => {
        set({ user: null, token: null, keyBackupStatus: "pending" as KeyBackupStatus, lastBackupAt: null, sessionPassword: null });
        // Clear local encryption key from memory
        import("../lib/keyStore").then(({ clearLocalEncryptionKey }) => clearLocalEncryptionKey());
        // Clear saved last-channel so the next user doesn't inherit it
        try { localStorage.removeItem("vibe-chat-last-channel"); } catch { /* ignore */ }
        // Clear chat store so next user doesn't see previous user's communities/messages
        import("./chat").then(({ useChatStore }) => useChatStore.getState().resetStore());
      },
      setHasHydrated: (state) => set({ _hasHydrated: state }),
      setKeyBackupStatus: (status) => set({ keyBackupStatus: status }),
      setLastBackupAt: (timestamp) => set({ lastBackupAt: timestamp }),
      setSessionPassword: (pw) => set({ sessionPassword: pw }),
    }),
    {
      name: "vibe-chat-auth",
      partialize: (state) => {
        // Exclude sessionPassword from persistence (in-memory only)
        const { sessionPassword: _, ...rest } = state;
        return rest;
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
