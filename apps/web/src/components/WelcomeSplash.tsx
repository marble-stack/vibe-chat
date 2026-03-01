import { useChatStore } from "../stores/chat";

export function WelcomeSplash() {
  const setShowCreateCommunityModal = useChatStore((s) => s.setShowCreateCommunityModal);
  const setShowJoinCommunityModal = useChatStore((s) => s.setShowJoinCommunityModal);

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="w-16 h-16 rounded-2xl bg-accent-primary/20 flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-accent-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-text-primary mb-3">Welcome to Vibe Chat</h1>

        <p className="text-text-secondary mb-6 leading-relaxed">
          End-to-end encrypted messaging with communities and channels.
          Your messages are only readable by members — not even the server can see them.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => setShowCreateCommunityModal(true)}
            className="px-6 py-3 bg-accent-primary hover:bg-accent-hover text-white rounded-lg font-medium transition-colors"
          >
            Create a Community
          </button>
          <button
            onClick={() => setShowJoinCommunityModal(true)}
            className="px-6 py-3 bg-background-tertiary hover:bg-background-tertiary/80 text-text-primary border border-text-muted/20 rounded-lg font-medium transition-colors"
          >
            Join a Community
          </button>
        </div>
      </div>
    </div>
  );
}
