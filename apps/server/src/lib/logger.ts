/**
 * Production-aware logger for the server
 *
 * Wraps console methods to provide environment-aware logging.
 * In production, debug logs are suppressed.
 */

const isDevelopment = process.env.NODE_ENV !== 'production';

export const logger = {
  /**
   * Debug level logging - only in development
   */
  debug: (...args: unknown[]) => {
    if (isDevelopment) {
      console.log('[DEBUG]', ...args);
    }
  },

  /**
   * Info level logging - only in development
   */
  info: (...args: unknown[]) => {
    if (isDevelopment) {
      console.log('[INFO]', ...args);
    }
  },

  /**
   * Warning level logging - always logged
   */
  warn: (...args: unknown[]) => {
    console.warn('[WARN]', ...args);
  },

  /**
   * Error level logging - always logged
   */
  error: (...args: unknown[]) => {
    console.error('[ERROR]', ...args);
  },
};
