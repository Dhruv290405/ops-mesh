/**
 * Rolling average of API request duration (ms). Updated by a tiny middleware in
 * app.ts and surfaced via /metrics/overview as `apiLatencyMs` (real, measured).
 */
let sum = 0;
let count = 0;

export function recordLatency(ms: number): void {
  // Ignore absurd outliers (e.g. keep-alive probes, long-polls).
  if (ms < 0 || ms > 30_000) return;
  sum += ms;
  count += 1;
  // Bound the window so the average stays recent.
  if (count > 2000) {
    sum = sum / count;
    count = 1;
  }
}

export function getAvgLatency(): number {
  return count === 0 ? 0 : sum / count;
}
