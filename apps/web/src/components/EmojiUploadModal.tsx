import { useState, useRef } from "react";
import { useChatStore } from "../stores/chat";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";
import { isSupportedImageType, processEmojiImage } from "../lib/imageUtils";

interface EmojiUploadModalProps {
  onClose: () => void;
}

export function EmojiUploadModal({ onClose }: EmojiUploadModalProps) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const user = useAuthStore((state) => state.user);
  const { activeCommunityId, addCustomEmoji } = useChatStore();

  const nameValid = /^[a-z0-9_]+$/.test(name) && name.length >= 1 && name.length <= 32;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    if (!isSupportedImageType(selected.type) && !selected.name.toLowerCase().match(/\.(heic|heif)$/)) {
      setError("Only PNG, GIF, WebP, JPEG, and HEIC images are allowed");
      return;
    }

    try {
      // Process (resize + convert) the image
      const processed = await processEmojiImage(selected);

      if (processed.size > 256 * 1024) {
        setError("Image is still over 256KB after resizing. Please use a smaller image.");
        return;
      }

      setError(null);
      setFile(processed);
      setPreview(URL.createObjectURL(processed));

      // Auto-fill name from filename if empty
      if (!name) {
        const baseName = selected.name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9_]/g, "_");
        setName(baseName.slice(0, 32));
      }
    } catch {
      setError("Failed to process image. HEIC files may not be supported in this browser.");
    }
  };

  const handleUpload = async () => {
    if (!file || !nameValid || !activeCommunityId || !user) return;

    setUploading(true);
    setError(null);

    try {
      // Upload image file
      const { fileUrl } = await api.emojis.uploadImage(file, activeCommunityId);

      // Create emoji record
      const { emoji } = await api.emojis.create({
        communityId: activeCommunityId,
        name,
        fileUrl,
        animated: file.type === "image/gif",
        uploadedBy: user.id,
      });

      addCustomEmoji(activeCommunityId, emoji);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
      <div className="bg-background-secondary rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
        <h3 className="text-lg font-semibold text-text-primary mb-4">Add Custom Emoji</h3>

        {/* File picker */}
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-background-tertiary rounded-lg p-4 flex flex-col items-center justify-center cursor-pointer hover:border-accent-primary/50 transition-colors mb-4"
        >
          {preview ? (
            <img src={preview} alt="Preview" className="w-16 h-16 object-contain" />
          ) : (
            <>
              <svg className="w-8 h-8 text-text-muted mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-sm text-text-muted">Click to select image</span>
              <span className="text-xs text-text-muted mt-1">PNG, GIF, WebP, JPEG, or HEIC (max 256KB)</span>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/gif,image/webp,image/jpeg,image/heic,image/heif,.heic,.heif,.jpg,.jpeg"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {/* Name input */}
        <div className="mb-4">
          <label className="block text-sm text-text-muted mb-1">Emoji name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
            placeholder="my_emoji"
            maxLength={32}
            className="w-full bg-background-tertiary text-text-primary px-3 py-2 rounded outline-none border border-background-tertiary focus:border-accent-primary text-sm"
          />
          {name && !nameValid && (
            <p className="text-xs text-red-400 mt-1">Lowercase letters, numbers, and underscores only</p>
          )}
        </div>

        {error && (
          <p className="text-sm text-red-400 mb-4">{error}</p>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded bg-background-tertiary text-text-primary hover:bg-background-primary text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={!file || !nameValid || uploading}
            className="px-4 py-2 rounded bg-accent-primary text-white hover:bg-accent-primary/80 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {uploading ? "Uploading..." : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}
