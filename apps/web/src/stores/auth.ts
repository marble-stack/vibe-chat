import { create } from "zustand";
import { persist } from "zustand/middleware";

interface User {
  id: string;
  email: string;
  displayName: string;
}

export type KeyBackupStatus = "pending" | "success" | "failed";

interface AuthState {
  user: User | null;
  token: string | null;
  _hasHydrated: boolean;
  keyBackupStatus: KeyBackupStatus;
  lastBackupAt: number | null;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  setAuth: (user: User, token: string) => void;
  logout: () => void;
  setHasHydrated: (state: boolean) => void;
  setKeyBackupStatus: (status: KeyBackupStatus) => void;
  setLastBackupAt: (timestamp: number) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      _hasHydrated: false,
      keyBackupStatus: "pending" as KeyBackupStatus,
      lastBackupAt: null,
      setUser: (user) => set({ user }),
      setToken: (token) => set({ token }),
      setAuth: (user, token) => set({ user, token }),
      logout: () => set({ user: null, token: null, keyBackupStatus: "pending" as KeyBackupStatus, lastBackupAt: null }),
      setHasHydrated: (state) => set({ _hasHydrated: state }),
      setKeyBackupStatus: (status) => set({ keyBackupStatus: status }),
      setLastBackupAt: (timestamp) => set({ lastBackupAt: timestamp }),
    }),
    {
      name: "vibe-chat-auth",
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
