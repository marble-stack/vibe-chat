import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";
import { isSupportedImageType, resizeImage } from "../lib/imageUtils";
import { generateFingerprint } from "../lib/crypto";
import { getIdentityKeys } from "../lib/keyStore";

interface UserSettingsModalProps {
  onClose: () => void;
}

export function UserSettingsModal({ onClose }: UserSettingsModalProps) {
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);

  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    user?.avatarUrl || null
  );
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [fpCopied, setFpCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load own fingerprint
  useEffect(() => {
    getIdentityKeys().then((keys) => {
      if (keys) {
        generateFingerprint(keys.identityKeyPair.publicKey).then(setFingerprint);
      }
    });
  }, []);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (
      !isSupportedImageType(file.type) &&
      !file.name.toLowerCase().match(/\.(heic|heif)$/)
    ) {
      setError("Please select a PNG, JPEG, GIF, or WebP image.");
      return;
    }

    try {
      const processed = await resizeImage(file, 256, 256, 0.85);
      setAvatarFile(processed);
      const reader = new FileReader();
      reader.onload = () => setAvatarPreview(reader.result as string);
      reader.readAsDataURL(processed);
      setError(null);
    } catch {
      setError("Failed to process image.");
    }
  };

  const handleRemoveAvatar = () => {
    setAvatarPreview(null);
    setAvatarFile(null);
  };

  const handleSave = async () => {
    if (!user) return;
    if (!displayName.trim()) {
      setError("Display name cannot be empty.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      let avatarUrl: string | null | undefined = undefined;

      // Upload new avatar if changed
      if (avatarFile) {
        const result = await api.auth.uploadAvatar(avatarFile);
        avatarUrl = result.avatarUrl;
      } else if (avatarPreview === null && user.avatarUrl) {
        // Avatar was removed
        avatarUrl = null;
      }

      const updates: { displayName?: string; avatarUrl?: string | null } = {};
      if (displayName.trim() !== user.displayName) {
        updates.displayName = displayName.trim();
      }
      if (avatarUrl !== undefined) {
        updates.avatarUrl = avatarUrl;
      }

      if (Object.keys(updates).length === 0) {
        onClose();
        return;
      }

      const { user: updatedUser } = await api.auth.updateProfile(updates);
      setUser(updatedUser);
      setSuccess(true);
      setTimeout(onClose, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  const handleCopyFingerprint = () => {
    if (fingerprint) {
      navigator.clipboard.writeText(fingerprint).then(() => {
        setFpCopied(true);
        setTimeout(() => setFpCopied(false), 2000);
      });
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100]"
      onClick={onClose}
    >
      <div
        className="bg-background-secondary rounded-lg p-6 w-[90vw] max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-text-primary mb-6">
          Edit Profile
        </h2>

        {/* Avatar */}
        <div className="flex flex-col items-center mb-6">
          <div
            className="w-24 h-24 rounded-full bg-accent-primary flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity overflow-hidden border-2 border-dashed border-text-muted/30 hover:border-accent-primary"
            onClick={() => fileInputRef.current?.click()}
          >
            {avatarPreview ? (
              <img
                src={avatarPreview}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-white text-3xl font-bold">
                {displayName.charAt(0).toUpperCase() || "?"}
              </span>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,.jpg,.jpeg"
            className="hidden"
            onChange={handleAvatarChange}
          />
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-xs text-accent-primary hover:underline"
            >
              {avatarPreview ? "Change" : "Upload"}
            </button>
            {avatarPreview && (
              <>
                <span className="text-xs text-text-muted">|</span>
                <button
                  type="button"
                  onClick={handleRemoveAvatar}
                  className="text-xs text-red-400 hover:underline"
                >
                  Remove
                </button>
              </>
            )}
          </div>
        </div>

        {/* Display Name */}
        <label className="block text-sm font-medium text-text-muted mb-1">
          Display Name
        </label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your display name"
          maxLength={50}
          className="w-full bg-background-primary border border-text-muted/30 text-text-primary placeholder:text-text-muted rounded px-4 py-3 mb-4 outline-none focus:ring-2 focus:ring-accent-primary"
        />

        {/* Security Fingerprint */}
        {fingerprint && (
          <div className="bg-background-primary border border-text-muted/20 rounded p-3 mb-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-text-muted">Your Security Fingerprint</span>
              <button
                onClick={handleCopyFingerprint}
                className="text-xs text-accent-primary hover:underline"
              >
                {fpCopied ? "Copied" : "Copy"}
              </button>
            </div>
            <code className="text-sm text-text-secondary font-mono">{fingerprint}</code>
            <p className="text-xs text-text-muted mt-2">
              Share this with your contacts to verify your identity. If it matches what they see on your profile, your connection is secure.
            </p>
          </div>
        )}

        {/* Error/Success messages */}
        {error && (
          <div className="text-red-400 text-sm mb-4">{error}</div>
        )}
        {success && (
          <div className="text-green-400 text-sm mb-4">
            Profile updated!
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2.5 bg-accent-primary hover:bg-accent-hover text-white rounded font-medium disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
