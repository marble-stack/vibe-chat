import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";
import { generateIdentityKeys, decryptKeyBackup, uploadKeyBackupWithRetry } from "../lib/crypto";
import { storeIdentityKeys, clearAllKeys, getIdentityKeys, importAllChannelKeys } from "../lib/keyStore";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [backupRestoreFailed, setBackupRestoreFailed] = useState(false);
  const [pendingLoginData, setPendingLoginData] = useState<{
    user: { id: string; email: string; displayName: string };
    token: string;
  } | null>(null);
  const setAuth = useAuthStore((state) => state.setAuth);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { user, token, hasKeyBackup } = await api.auth.login(email, password);
      const { setKeyBackupStatus, setLastBackupAt } = useAuthStore.getState();

      // Check if we already have identity keys for this user
      const existingKeys = await getIdentityKeys();

      let needsBackupUpload = false;
      let keysForBackup: Awaited<ReturnType<typeof generateIdentityKeys>>["keys"] | null = null;

      if (existingKeys && existingKeys.userId === user.id) {
        // Same device — reuse existing keys, mark backup as success (already backed up)
        setKeyBackupStatus("success");
      } else if (hasKeyBackup) {
        // New device with backup available — restore identity keys
        try {
          const { encryptedKeyBackup, salt } = await api.auth.getKeyBackup(token);
          if (encryptedKeyBackup && salt) {
            const restored = await decryptKeyBackup(encryptedKeyBackup, password, salt);
            const { channelKeys: restoredChannelKeys, ...identityKeys } = restored;
            await clearAllKeys();
            await storeIdentityKeys(user.id, identityKeys);
            if (restoredChannelKeys && Object.keys(restoredChannelKeys).length > 0) {
              await importAllChannelKeys(restoredChannelKeys);
            }
            useAuthStore.getState().setSessionPassword(password);
            setKeyBackupStatus("success");
          } else {
            throw new Error("Backup data missing");
          }
        } catch (backupErr) {
          // Backup restore failed — let the user decide what to do
          console.warn("Backup restore failed:", backupErr);
          setPendingLoginData({ user, token });
          setBackupRestoreFailed(true);
          setLoading(false);
          return; // Don't complete login yet — wait for user decision
        }
      } else {
        // No backup — generate new keys
        await clearAllKeys();
        const { keys, publicBundle } = await generateIdentityKeys();
        await api.auth.updateKeys(publicBundle, token);
        await storeIdentityKeys(user.id, keys);
        keysForBackup = keys;
        needsBackupUpload = true;
      }

      setAuth(user, token);

      // Store password in memory for backup re-upload with channel keys later
      useAuthStore.getState().setSessionPassword(password);

      // Upload backup with retry if needed (runs after auth is set)
      if (needsBackupUpload && keysForBackup) {
        setKeyBackupStatus("pending");
        const backupKeys = keysForBackup;
        uploadKeyBackupWithRetry(backupKeys, password, token).then((success) => {
          if (success) {
            setKeyBackupStatus("success");
            setLastBackupAt(Date.now());
          } else {
            setKeyBackupStatus("failed");
          }
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleRetryRestore = async () => {
    if (!pendingLoginData) return;
    setLoading(true);
    setError("");
    const { user, token } = pendingLoginData;
    const { setKeyBackupStatus } = useAuthStore.getState();

    try {
      const { encryptedKeyBackup, salt } = await api.auth.getKeyBackup(token);
      if (encryptedKeyBackup && salt) {
        const restored = await decryptKeyBackup(encryptedKeyBackup, password, salt);
        const { channelKeys: restoredChannelKeys, ...identityKeys } = restored;
        await clearAllKeys();
        await storeIdentityKeys(user.id, identityKeys);
        if (restoredChannelKeys && Object.keys(restoredChannelKeys).length > 0) {
          await importAllChannelKeys(restoredChannelKeys);
        }
        useAuthStore.getState().setSessionPassword(password);
        setKeyBackupStatus("success");
        setBackupRestoreFailed(false);
        setPendingLoginData(null);
        setAuth(user, token);
      } else {
        throw new Error("Backup data missing");
      }
    } catch (_err) {
      setError("Retry failed. You can try again or start fresh with new keys.");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateNewKeys = async () => {
    if (!pendingLoginData) return;
    setLoading(true);
    setError("");
    const { user, token } = pendingLoginData;
    const { setKeyBackupStatus } = useAuthStore.getState();

    try {
      await clearAllKeys();
      const { keys, publicBundle } = await generateIdentityKeys();
      await api.auth.updateKeys(publicBundle, token);
      await storeIdentityKeys(user.id, keys);

      // Do NOT upload backup here — preserve the old backup in case another device still has working keys
      setKeyBackupStatus("pending");
      setBackupRestoreFailed(false);
      setPendingLoginData(null);
      setAuth(user, token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate new keys");
    } finally {
      setLoading(false);
    }
  };

  if (backupRestoreFailed) {
    return (
      <div className="min-h-screen bg-background-tertiary flex items-center justify-center p-4">
        <div className="bg-background-secondary rounded-lg p-8 w-full max-w-md">
          <h1 className="text-2xl font-bold text-text-primary mb-2">Key Restore Failed</h1>
          <p className="text-text-secondary mb-4">
            We couldn't restore your encryption keys from backup. This can happen due to a network
            issue or if your password changed since the backup was created.
          </p>

          <div className="bg-background-tertiary rounded p-3 mb-4">
            <p className="text-text-secondary text-sm">
              <strong className="text-text-primary">Retry</strong> — Try restoring again (recommended if this might be a temporary issue).
            </p>
          </div>

          <div className="bg-background-tertiary rounded p-3 mb-4">
            <p className="text-text-secondary text-sm">
              <strong className="text-yellow-400">Start fresh</strong> — Generate new encryption keys. You won't be able to read old encrypted messages on this device.
            </p>
          </div>

          {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

          <div className="flex gap-3">
            <button
              onClick={handleRetryRestore}
              disabled={loading}
              className="flex-1 bg-accent-primary hover:bg-accent-hover text-white font-medium py-2 rounded transition-colors disabled:opacity-50"
            >
              {loading ? "Retrying..." : "Retry"}
            </button>
            <button
              onClick={handleGenerateNewKeys}
              disabled={loading}
              className="flex-1 bg-background-tertiary hover:bg-background-tertiary/80 text-yellow-400 border border-yellow-400/50 font-medium py-2 rounded transition-colors disabled:opacity-50"
            >
              Start Fresh
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background-tertiary flex items-center justify-center p-4">
      <div className="bg-background-secondary rounded-lg p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-text-primary mb-2">Welcome back!</h1>
        <p className="text-text-secondary mb-6">We're so excited to see you again!</p>

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

        <p className="text-center text-text-muted text-sm mt-4">
          Need an account?{" "}
          <Link to="/register" className="text-accent-primary hover:underline">
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}
