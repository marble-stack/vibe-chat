import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";
import { generateIdentityKeys, encryptKeyBackup, decryptKeyBackup } from "../lib/crypto";
import { storeIdentityKeys, clearAllKeys, getIdentityKeys } from "../lib/keyStore";

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
      const { user, token, hasKeyBackup } = await api.auth.login(email, password);

      // Check if we already have identity keys for this user
      const existingKeys = await getIdentityKeys();

      if (existingKeys && existingKeys.userId === user.id) {
        // Same device — reuse existing keys
        console.log("Reusing existing identity keys for user:", user.id);
      } else if (hasKeyBackup) {
        // New device with backup available — restore identity keys
        console.log("Restoring identity keys from backup for user:", user.id);
        try {
          const { encryptedKeyBackup, salt } = await api.auth.getKeyBackup(token);
          if (encryptedKeyBackup && salt) {
            const restoredKeys = await decryptKeyBackup(encryptedKeyBackup, password, salt);
            await clearAllKeys();
            await storeIdentityKeys(user.id, restoredKeys);
            console.log("Identity keys restored from backup successfully");
          } else {
            // Backup data missing — fall through to new key generation
            throw new Error("Backup data missing");
          }
        } catch (backupErr) {
          // Backup restore failed — generate new keys as fallback
          console.warn("Backup restore failed, generating new keys:", backupErr);
          await clearAllKeys();
          const { keys, publicBundle } = await generateIdentityKeys();
          await api.auth.updateKeys(publicBundle, token);
          await storeIdentityKeys(user.id, keys);
          // Upload new backup
          encryptKeyBackup(keys, password)
            .then(({ ciphertext, salt: s }) =>
              api.auth.uploadKeyBackup({ encryptedKeyBackup: ciphertext, salt: s }, token)
            )
            .catch((err) => console.warn("Failed to upload key backup:", err));
        }
      } else {
        // No backup — generate new keys (existing behavior)
        console.log("Generating new identity keys for user:", user.id);
        await clearAllKeys();
        const { keys, publicBundle } = await generateIdentityKeys();
        await api.auth.updateKeys(publicBundle, token);
        await storeIdentityKeys(user.id, keys);
        // Upload backup for future device logins
        encryptKeyBackup(keys, password)
          .then(({ ciphertext, salt }) =>
            api.auth.uploadKeyBackup({ encryptedKeyBackup: ciphertext, salt }, token)
          )
          .catch((err) => console.warn("Failed to upload key backup:", err));
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

          {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

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
