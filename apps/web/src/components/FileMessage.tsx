import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { decryptFile } from "../lib/fileCrypto";
import { getChannelKey } from "../lib/keyStore";
import { logger } from "../lib/logger";

interface FileMetadata {
  type: "file";
  filename: string;
  size: number;
  mimeType: string;
  fileId: string;
}

interface FileMessageProps {
  metadata: FileMetadata;
  channelId: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileMessage({ metadata, channelId }: FileMessageProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isImage = metadata.mimeType.startsWith("image/");

  // Auto-load images
  useEffect(() => {
    if (!isImage) return;

    let objectUrl: string | null = null;

    const loadImage = async () => {
      setLoading(true);
      setError(null);
      try {
        const channelKey = await getChannelKey(channelId);
        if (!channelKey) {
          setError("No encryption key available");
          return;
        }

        const { blob, iv } = await api.files.download(metadata.fileId);
        const decryptedBlob = await decryptFile(blob, iv, channelKey);
        objectUrl = URL.createObjectURL(decryptedBlob);
        setImageUrl(objectUrl);
      } catch (err) {
        logger.error("Failed to load image:", err);
        setError("Failed to load image");
      } finally {
        setLoading(false);
      }
    };

    loadImage();

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isImage, metadata.fileId, channelId]);

  const handleDownload = async () => {
    setLoading(true);
    setError(null);
    try {
      const channelKey = await getChannelKey(channelId);
      if (!channelKey) {
        setError("No encryption key available");
        return;
      }

      const { blob, iv } = await api.files.download(metadata.fileId);
      const decryptedBlob = await decryptFile(blob, iv, channelKey);

      // Trigger download
      const url = URL.createObjectURL(decryptedBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = metadata.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      logger.error("Failed to download file:", err);
      setError("Failed to download file");
    } finally {
      setLoading(false);
    }
  };

  if (isImage) {
    return (
      <div className="mt-1">
        {loading && (
          <div className="w-48 h-32 bg-background-tertiary rounded-lg flex items-center justify-center">
            <span className="text-text-muted text-sm">Loading...</span>
          </div>
        )}
        {error && <span className="text-red-400 text-sm">{error}</span>}
        {imageUrl && (
          <img
            src={imageUrl}
            alt={metadata.filename}
            className="max-w-sm max-h-80 rounded-lg cursor-pointer"
            onClick={handleDownload}
            title={`${metadata.filename} (${formatFileSize(metadata.size)}) - Click to download`}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 bg-background-tertiary rounded-lg p-3 mt-1 max-w-sm">
      <svg className="w-8 h-8 text-accent-primary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-text-primary text-sm font-medium truncate">{metadata.filename}</p>
        <p className="text-text-muted text-xs">{formatFileSize(metadata.size)}</p>
        {error && <p className="text-red-400 text-xs">{error}</p>}
      </div>
      <button
        onClick={handleDownload}
        disabled={loading}
        className="text-accent-primary hover:text-accent-primary/80 p-1 disabled:opacity-50"
        title="Download"
      >
        {loading ? (
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        )}
      </button>
    </div>
  );
}
