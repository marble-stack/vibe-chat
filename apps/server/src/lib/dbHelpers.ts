/**
 * Database operation helper functions for safer operations
 */

import { logger } from "./logger.js";

/**
 * Safely extract a single result from a .returning() call.
 * Throws a descriptive error if the array is empty.
 *
 * @param results - The array returned from .returning()
 * @param operation - Description of the operation for error messages
 * @returns The single result from the array
 * @throws Error if results is empty
 *
 * @example
 * const [user] = await db.insert(users).values({...}).returning();
 * // becomes:
 * const user = assertSingleResult(
 *   await db.insert(users).values({...}).returning(),
 *   'insert user'
 * );
 */
export function assertSingleResult<T>(results: T[], operation: string): T {
  if (results.length === 0) {
    const error = new Error(`Database operation failed: ${operation} returned no results`);
    logger.error(error.message);
    throw error;
  }
  return results[0];
}
