import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";
import { generateIdentityKeys } from "../lib/crypto";
import { storeIdentityKeys, hasIdentityKeys } from "../lib/keyStore";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((state) => state.setAuth);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { user, token } = await api.auth.login(email, password);

      // Check if we have identity keys locally
      const hasKeys = await hasIdentityKeys();
      if (!hasKeys) {
        // Regenerate keys for this device and update on server
        // Note: This means old messages encrypted for the old keys won't be decryptable
        const { keys, publicBundle } = await generateIdentityKeys();

        // Update keys on server
        await api.auth.updateKeys(publicBundle, token);

        // Store new keys locally
        await storeIdentityKeys(user.id, keys);
      }

      setAuth(user, token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background-tertiary flex items-center justify-center p-4">
      <div className="bg-background-secondary rounded-lg p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-text-primary mb-2">Welcome back!</h1>
        <p className="text-text-secondary mb-4">We're so excited to see you again!</p>

        <Link
          to="/register"
          className="block w-full text-center py-2 mb-6 border border-accent-primary text-accent-primary hover:bg-accent-primary/10 rounded transition-colors"
        >
          New here? Create an account
        </Link>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-text-secondary text-xs font-semibold uppercase mb-2">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-background-tertiary text-text-primary rounded px-3 py-2 outline-none focus:ring-2 focus:ring-accent-primary"
              required
            />
          </div>

          <div className="mb-4">
            <label className="block text-text-secondary text-xs font-semibold uppercase mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-background-tertiary text-text-primary rounded px-3 py-2 outline-none focus:ring-2 focus:ring-accent-primary"
              required
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm mb-4">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent-primary hover:bg-accent-hover text-white font-medium py-2 rounded transition-colors disabled:opacity-50"
          >
            {loading ? "Logging in..." : "Log In"}
          </button>
        </form>

      </div>
    </div>
  );
}
