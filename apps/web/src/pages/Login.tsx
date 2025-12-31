import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";

export function Login() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const setUser = useAuthStore((state) => state.setUser);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { user } = await api.auth.login(email);
      setUser(user);
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

          {error && (
            <p className="text-red-400 text-sm mb-4">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent-primary hover:bg-accent-hover text-white font-medium py-2 rounded transition-colors disabled:opacity-50"
          >
            {loading ? "Logging in..." : "Log In"}
          </button>
        </form>

        <p className="text-text-secondary text-sm mt-4">
          Need an account?{" "}
          <Link to="/register" className="text-accent-primary hover:underline">
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}
