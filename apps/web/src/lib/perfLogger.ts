/**
 * Lightweight performance timing utility.
 * Only active in development mode — zero-cost in production.
 */

const isDev = import.meta.env.DEV;

interface Timing {
  label: string;
  startTime: number;
  endTime?: number;
  elapsed?: number;
}

const activeTimers = new Map<string, number>();
const timings: Timing[] = [];

export function startTimer(label: string): void {
  if (!isDev) return;
  activeTimers.set(label, performance.now());
}

export function endTimer(label: string): number | undefined {
  if (!isDev) return undefined;
  const start = activeTimers.get(label);
  if (start === undefined) return undefined;

  const end = performance.now();
  const elapsed = end - start;
  activeTimers.delete(label);

  timings.push({ label, startTime: start, endTime: end, elapsed });
  console.log(`[PERF] ${label}: ${elapsed.toFixed(2)}ms`);
  return elapsed;
}

export function getTimings(): Timing[] {
  return [...timings];
}

export function clearTimings(): void {
  timings.length = 0;
}
