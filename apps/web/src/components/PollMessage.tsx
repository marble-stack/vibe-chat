import { useEffect } from "react";
import { useChatStore } from "../stores/chat";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";
import { logger } from "../lib/logger";

interface PollMetadata {
  type: "poll";
  question: string;
  options: string[];
  allowMultiple: boolean;
}

interface PollMessageProps {
  metadata: PollMetadata;
  messageId: string;
}

export function PollMessage({ metadata, messageId }: PollMessageProps) {
  const user = useAuthStore((state) => state.user);
  const { pollVotes, setPollVotes, updatePollVote } = useChatStore();
  const votes = pollVotes[messageId] || [];

  // Fetch results on mount
  useEffect(() => {
    const fetchResults = async () => {
      try {
        const { votes: results } = await api.polls.getResults(messageId);
        setPollVotes(messageId, results);
      } catch (err) {
        logger.error("Failed to fetch poll results:", err);
      }
    };

    fetchResults();
  }, [messageId, setPollVotes]);

  const totalVotes = votes.reduce((sum, v) => sum + v.count, 0);

  const getVoteCount = (index: number) => {
    return votes.find((v) => v.optionIndex === index)?.count || 0;
  };

  const hasUserVoted = (index: number) => {
    if (!user) return false;
    return votes.find((v) => v.optionIndex === index)?.userIds.includes(user.id) || false;
  };

  const getUserVotedOptions = (): number[] => {
    if (!user) return [];
    return votes
      .filter((v) => v.userIds.includes(user.id))
      .map((v) => v.optionIndex);
  };

  const handleVote = async (optionIndex: number) => {
    if (!user) return;

    const alreadyVoted = hasUserVoted(optionIndex);
    const previousVotes = getUserVotedOptions();

    // Optimistic update
    if (!alreadyVoted && !metadata.allowMultiple) {
      // Single-vote mode: remove previous votes optimistically
      for (const prevIdx of previousVotes) {
        updatePollVote(messageId, user.id, prevIdx, "remove");
      }
    }
    updatePollVote(messageId, user.id, optionIndex, alreadyVoted ? "remove" : "add");

    try {
      if (alreadyVoted) {
        await api.polls.removeVote(messageId, optionIndex);
      } else {
        await api.polls.vote(messageId, optionIndex, !metadata.allowMultiple);
      }

      // Re-fetch to ensure consistency
      const { votes: results } = await api.polls.getResults(messageId);
      setPollVotes(messageId, results);
    } catch (err) {
      logger.error("Failed to vote:", err);
      // Revert optimistic updates
      if (!alreadyVoted && !metadata.allowMultiple) {
        for (const prevIdx of previousVotes) {
          updatePollVote(messageId, user.id, prevIdx, "add");
        }
      }
      updatePollVote(messageId, user.id, optionIndex, alreadyVoted ? "add" : "remove");
    }
  };

  return (
    <div className="bg-background-tertiary rounded-lg p-3 mt-1 max-w-sm">
      <p className="font-medium text-text-primary mb-2">{metadata.question}</p>

      <div className="space-y-1.5">
        {metadata.options.map((option, index) => {
          const count = getVoteCount(index);
          const percentage = totalVotes > 0 ? (count / totalVotes) * 100 : 0;
          const voted = hasUserVoted(index);

          return (
            <button
              key={index}
              onClick={() => handleVote(index)}
              className={`w-full text-left relative rounded overflow-hidden p-2 text-sm transition-colors ${
                voted
                  ? "border border-accent-primary"
                  : "border border-background-secondary hover:border-text-muted"
              }`}
            >
              {/* Vote bar background */}
              <div
                className={`absolute inset-0 ${voted ? "bg-accent-primary/20" : "bg-background-secondary"}`}
                style={{ width: `${percentage}%` }}
              />
              <div className="relative flex justify-between items-center">
                <span className="text-text-primary">
                  {voted && <span className="mr-1">&#10003;</span>}
                  {option}
                </span>
                <span className="text-text-muted text-xs ml-2">
                  {count} {count === 1 ? "vote" : "votes"}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-text-muted">
          {totalVotes} total {totalVotes === 1 ? "vote" : "votes"}
        </span>
        {metadata.allowMultiple && (
          <span className="text-xs text-text-muted">Multiple votes allowed</span>
        )}
      </div>
    </div>
  );
}
