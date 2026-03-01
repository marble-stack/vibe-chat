import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";
import { generateIdentityKeys, uploadKeyBackupWithRetry } from "../lib/crypto";
import { storeIdentityKeys } from "../lib/keyStore";

export function Register() {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("");
  const setAuth = useAuthStore((state) => state.setAuth);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Validate password match
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    // Validate password length
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);

    try {
      // Generate real cryptographic keys using Web Crypto API
      setLoadingStatus("Generating encryption keys...");
      const { keys, publicBundle } = await generateIdentityKeys();

      setLoadingStatus("Creating account...");
      const { user, token } = await api.auth.register({
        email,
        password,
        displayName,
        ...publicBundle,
      });

      // Store private keys locally in IndexedDB
      setLoadingStatus("Storing keys...");
      await storeIdentityKeys(user.id, keys);

      setAuth(user, token);

      // Upload encrypted key backup with retry (runs after auth is set)
      const { setKeyBackupStatus, setLastBackupAt } = useAuthStore.getState();
      setKeyBackupStatus("pending");
      uploadKeyBackupWithRetry(keys, password, token).then((success) => {
        if (success) {
          setKeyBackupStatus("success");
          setLastBackupAt(Date.now());
        } else {
          setKeyBackupStatus("failed");
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
      setLoadingStatus("");
    }
  };

  return (
    <div className="min-h-screen bg-background-tertiary flex items-center justify-center p-4">
      <div className="bg-background-secondary rounded-lg p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-text-primary mb-2">Create an account</h1>
        <p className="text-text-secondary mb-6">Join Vibe Chat today</p>

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
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
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
              minLength={8}
            />
            <p className="text-text-muted text-xs mt-1">At least 8 characters</p>
            <p className="text-text-muted text-xs mt-1">
              Your password also protects your encryption keys across devices. Use a strong, unique
              password.
            </p>
          </div>

          <div className="mb-4">
            <label className="block text-text-secondary text-xs font-semibold uppercase mb-2">
              Confirm Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full bg-background-tertiary text-text-primary rounded px-3 py-2 outline-none focus:ring-2 focus:ring-accent-primary"
              required
              minLength={8}
            />
          </div>

          {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent-primary hover:bg-accent-hover text-white font-medium py-2 rounded transition-colors disabled:opacity-50"
          >
            {loading ? (loadingStatus || "Creating account...") : "Continue"}
          </button>
        </form>

        <p className="text-center text-text-muted text-sm mt-4">
          Already have an account?{" "}
          <Link to="/login" className="text-accent-primary hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
