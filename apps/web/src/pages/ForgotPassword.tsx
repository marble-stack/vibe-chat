import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await api.auth.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="min-h-screen bg-background-tertiary flex items-center justify-center p-4">
        <div className="bg-background-secondary rounded-lg p-8 w-full max-w-md">
          <h1 className="text-2xl font-bold text-text-primary mb-2">Check your email</h1>
          <p className="text-text-secondary mb-6">
            If an account exists for <strong className="text-text-primary">{email}</strong>, we've sent a temporary password. Check your email and use it to reset your password.
          </p>
          <Link
            to={`/reset-password?email=${encodeURIComponent(email)}`}
            className="block w-full bg-accent-primary hover:bg-accent-hover text-white font-medium py-2 rounded transition-colors text-center"
          >
            Enter Temporary Password
          </Link>
          <p className="text-center text-text-muted text-sm mt-4">
            Didn't get the email?{" "}
            <button
              onClick={() => setSent(false)}
              className="text-accent-primary hover:underline"
            >
              Try again
            </button>
          </p>
          <p className="text-center text-text-muted text-sm mt-2">
            <Link to="/login" className="text-accent-primary hover:underline">
              Back to login
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background-tertiary flex items-center justify-center p-4">
      <div className="bg-background-secondary rounded-lg p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-text-primary mb-2">Forgot your password?</h1>
        <p className="text-text-secondary mb-6">
          Enter your email and we'll send you a temporary password to reset it.
        </p>

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
              autoFocus
            />
          </div>

          {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent-primary hover:bg-accent-hover text-white font-medium py-2 rounded transition-colors disabled:opacity-50"
          >
            {loading ? "Sending..." : "Send Temporary Password"}
          </button>
        </form>

        <p className="text-center text-text-muted text-sm mt-4">
          <Link to="/login" className="text-accent-primary hover:underline">
            Back to login
          </Link>
        </p>
      </div>
    </div>
  );
}
