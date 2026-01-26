import { Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./stores/auth";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { Chat } from "./pages/Chat";

function App() {
  const user = useAuthStore((state) => state.user);
  const hasHydrated = useAuthStore((state) => state._hasHydrated);

  // Show loading while auth store is rehydrating from localStorage
  // This prevents incorrect redirects on mobile before auth is restored
  if (!hasHydrated) {
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
      <Route
        path="/login"
        element={user ? <Navigate to="/chat" replace /> : <Login />}
      />
      <Route
        path="/register"
        element={user ? <Navigate to="/chat" replace /> : <Register />}
      />
      <Route
        path="/chat/*"
        element={user ? <Chat /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/invite/:inviteCode"
        element={user ? <Chat /> : <Navigate to="/login" replace />}
      />
    </Routes>
  );
}

export default App;
