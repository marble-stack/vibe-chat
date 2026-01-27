/**
 * Production-aware logger
 *
 * Provides console logging that respects the environment.
 * Debug and info logs are suppressed in production.
 * Errors and warnings are always logged.
 */

const isDevelopment = import.meta.env.DEV;

export const logger = {
  /**
   * Debug level logging - only in development
   */
  debug: (...args: unknown[]) => {
    if (isDevelopment) {
      console.log("[DEBUG]", ...args);
    }
  },

  /**
   * Info level logging - only in development
   */
  info: (...args: unknown[]) => {
    if (isDevelopment) {
      console.log("[INFO]", ...args);
    }
  },

  /**
   * Warning level logging - always logged
   */
  warn: (...args: unknown[]) => {
    console.warn("[WARN]", ...args);
  },

  /**
   * Error level logging - always logged
   * In production, you may want to send these to an error tracking service
   */
  error: (...args: unknown[]) => {
    console.error("[ERROR]", ...args);
    // TODO: In production, send to error tracking service (e.g., Sentry)
  },
};
