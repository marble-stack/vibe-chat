import { useState } from "react";
import { useChatStore } from "../stores/chat";
import { useAuthStore } from "../stores/auth";
import { wsClient } from "../lib/websocket";
import { encryptChannelMessage } from "../lib/channelCrypto";
import { logger } from "../lib/logger";

interface PollCreatorProps {
  channelId: string;
  onClose: () => void;
}

export function PollCreator({ channelId, onClose }: PollCreatorProps) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { activeCommunityId, members } = useChatStore();
  const user = useAuthStore((state) => state.user);
  const communityMembers = activeCommunityId ? members[activeCommunityId] || [] : [];

  const addOption = () => {
    if (options.length < 10) {
      setOptions([...options, ""]);
    }
  };

  const removeOption = (index: number) => {
    if (options.length > 2) {
      setOptions(options.filter((_, i) => i !== index));
    }
  };

  const updateOption = (index: number, value: string) => {
    const newOptions = [...options];
    newOptions[index] = value;
    setOptions(newOptions);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || !user || isSending) return;

    const filledOptions = options.filter((o) => o.trim());
    if (filledOptions.length < 2) {
      setError("At least 2 options are required");
      return;
    }

    setIsSending(true);
    setError(null);

    const membersWithSelf = communityMembers.some((m) => m.id === user.id)
      ? communityMembers
      : [...communityMembers, { id: user.id, displayName: user.displayName || "Me" }];

    try {
      const pollData = JSON.stringify({
        type: "poll",
        question: question.trim(),
        options: filledOptions.map((o) => o.trim()),
        allowMultiple,
      });

      const ciphertext = await encryptChannelMessage(
        channelId,
        pollData,
        membersWithSelf,
        user.id
      );

      wsClient.sendMessage(channelId, ciphertext);
      onClose();
    } catch (err) {
      logger.error("Failed to create poll:", err);
      setError("Failed to create poll. Please try again.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background-secondary rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        <h3 className="text-lg font-semibold text-text-primary mb-4">Create Poll</h3>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm text-text-muted mb-1">Question</label>
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question..."
              className="w-full bg-background-tertiary text-text-primary px-3 py-2 rounded outline-none border border-background-tertiary focus:border-accent-primary"
              autoFocus
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm text-text-muted mb-1">Options</label>
            {options.map((option, index) => (
              <div key={index} className="flex items-center gap-2 mb-2">
                <input
                  type="text"
                  value={option}
                  onChange={(e) => updateOption(index, e.target.value)}
                  placeholder={`Option ${index + 1}`}
                  className="flex-1 bg-background-tertiary text-text-primary px-3 py-1.5 rounded outline-none border border-background-tertiary focus:border-accent-primary text-sm"
                />
                {options.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removeOption(index)}
                    className="text-text-muted hover:text-red-400 p-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
            {options.length < 10 && (
              <button
                type="button"
                onClick={addOption}
                className="text-sm text-accent-primary hover:text-accent-primary/80"
              >
                + Add option
              </button>
            )}
          </div>

          <div className="mb-4">
            <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
              <input
                type="checkbox"
                checked={allowMultiple}
                onChange={(e) => setAllowMultiple(e.target.checked)}
                className="rounded"
              />
              Allow multiple votes
            </label>
          </div>

          {error && (
            <p className="text-red-400 text-sm mb-4">{error}</p>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded bg-background-tertiary text-text-primary hover:bg-background-primary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!question.trim() || isSending}
              className="px-4 py-2 rounded bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-50"
            >
              {isSending ? "Creating..." : "Create Poll"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
