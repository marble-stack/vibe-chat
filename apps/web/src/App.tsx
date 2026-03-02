import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./stores/auth";
import { useThemeStore, applyTheme } from "./stores/theme";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ResetPassword } from "./pages/ResetPassword";
import { Chat } from "./pages/Chat";
import { InviteRedirect } from "./pages/InviteRedirect";
import { hasIdentityKeys, storeIdentityKeys } from "./lib/keyStore";
import { generateIdentityKeys } from "./lib/crypto";
import { api } from "./lib/api";
import { logger } from "./lib/logger";

function App() {
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const hasHydrated = useAuthStore((state) => state._hasHydrated);
  const [keysInitialized, setKeysInitialized] = useState(false);
  const theme = useThemeStore((state) => state.theme);

  // Apply theme on mount and when theme changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Ensure identity keys exist when auth is restored from localStorage
  // IndexedDB might be cleared separately from localStorage, causing decryption failures
  useEffect(() => {
    if (!hasHydrated || !user || !token) {
      setKeysInitialized(true);
      return;
    }

    const ensureKeys = async () => {
      try {
        const hasKeys = await hasIdentityKeys();
        if (!hasKeys) {
          logger.info("Identity keys missing - regenerating...");

          // Generate fresh identity keys
          const { keys, publicBundle } = await generateIdentityKeys();

          // Update keys on server
          await api.auth.updateKeys(publicBundle, token);

          // Store new keys locally
          await storeIdentityKeys(user.id, keys);

          logger.info("Identity keys regenerated successfully");
        }
      } catch (err) {
        logger.error("Failed to ensure identity keys:", err);
      } finally {
        setKeysInitialized(true);
      }
    };

    ensureKeys();
  }, [hasHydrated, user, token]);

  // Show loading while auth store is rehydrating from localStorage
  // or while ensuring identity keys exist
  if (!hasHydrated || !keysInitialized) {
    return (
      <div className="min-h-screen bg-background-tertiary flex items-center justify-center">
        <div className="text-text-secondary">Loading...</div>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/"
        element={user ? <Navigate to="/chat" replace /> : <Navigate to="/login" replace />}
      />
      <Route path="/login" element={user ? <Navigate to="/chat" replace /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to="/chat" replace /> : <Register />} />
      <Route path="/forgot-password" element={user ? <Navigate to="/chat" replace /> : <ForgotPassword />} />
      <Route path="/reset-password" element={user ? <Navigate to="/chat" replace /> : <ResetPassword />} />
      <Route path="/chat/*" element={user ? <Chat /> : <Navigate to="/login" replace />} />
      <Route
        path="/invite/:inviteCode"
        element={user ? <InviteRedirect /> : <Navigate to={`/login?redirect=${window.location.pathname}`} replace />}
      />
    </Routes>
  );
}

export default App;
