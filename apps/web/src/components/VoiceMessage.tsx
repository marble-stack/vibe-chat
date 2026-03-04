import { useState, useEffect, useRef } from "react";
import { api } from "../lib/api";
import { decryptFile } from "../lib/fileCrypto";
import { getChannelKey } from "../lib/keyStore";
import { logger } from "../lib/logger";

interface VoiceMetadata {
  type: "voice";
  fileId: string;
  duration: number;
  mimeType: string;
}

interface VoiceMessageProps {
  metadata: VoiceMetadata;
  channelId: string;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function VoiceMessage({ metadata, channelId }: VoiceMessageProps) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(metadata.duration || 0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Load and decrypt audio on mount
  useEffect(() => {
    let objectUrl: string | null = null;

    const loadAudio = async () => {
      setLoading(true);
      setError(null);
      try {
        const channelKey = await getChannelKey(channelId);
        if (!channelKey) {
          setError("No encryption key");
          return;
        }

        const { blob, iv } = await api.files.download(metadata.fileId);
        const decryptedBlob = await decryptFile(blob, iv, channelKey);
        objectUrl = URL.createObjectURL(decryptedBlob);
        setAudioUrl(objectUrl);

        // Create audio element
        const audio = new Audio(objectUrl);
        audioRef.current = audio;

        audio.addEventListener("loadedmetadata", () => {
          if (audio.duration && isFinite(audio.duration)) {
            setDuration(Math.floor(audio.duration));
          }
        });

        audio.addEventListener("ended", () => {
          setIsPlaying(false);
          setCurrentTime(0);
        });
      } catch (err) {
        logger.error("Failed to load voice note:", err);
        setError("Failed to load");
      } finally {
        setLoading(false);
      }
    };

    loadAudio();

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [metadata.fileId, channelId, metadata.duration]);

  const updateProgress = () => {
    if (audioRef.current && isPlaying) {
      setCurrentTime(audioRef.current.currentTime);
      animFrameRef.current = requestAnimationFrame(updateProgress);
    }
  };

  const togglePlayback = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    } else {
      audioRef.current.play();
      setIsPlaying(true);
      animFrameRef.current = requestAnimationFrame(updateProgress);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = x / rect.width;
    const newTime = pct * duration;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (loading) {
    return (
      <div className="flex items-center gap-3 bg-background-tertiary rounded-lg p-3 mt-1 max-w-xs">
        <div className="w-8 h-8 rounded-full bg-accent-primary/20 flex items-center justify-center">
          <svg className="w-4 h-4 animate-spin text-accent-primary" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
        <span className="text-text-muted text-sm">Loading voice note...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 bg-background-tertiary rounded-lg p-3 mt-1 max-w-xs">
        <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
        <span className="text-red-400 text-sm">{error}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 bg-background-tertiary rounded-2xl p-3 mt-1 max-w-xs">
      {/* Play/Pause button */}
      <button
        onClick={togglePlayback}
        disabled={!audioUrl}
        className="w-10 h-10 rounded-full bg-accent-primary flex items-center justify-center text-white flex-shrink-0 hover:bg-accent-hover transition-colors disabled:opacity-50"
      >
        {isPlaying ? (
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
          </svg>
        ) : (
          <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      <div className="flex-1 min-w-0">
        {/* Waveform / progress bar */}
        <div
          className="h-8 flex items-center cursor-pointer"
          onClick={handleSeek}
        >
          <div className="relative w-full h-1.5 bg-background-primary rounded-full overflow-hidden">
            <div
              className="absolute left-0 top-0 h-full bg-accent-primary rounded-full transition-all duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Duration */}
        <div className="flex justify-between text-xs text-text-muted mt-0.5">
          <span>{formatDuration(Math.floor(currentTime))}</span>
          <span>{formatDuration(duration)}</span>
        </div>
      </div>
    </div>
  );
}
