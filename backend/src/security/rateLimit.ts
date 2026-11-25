/** Fixed-window per-IP rate limiter (in memory). */
import { config } from '../config.js';

const windows = new Map<string, { start: number; count: number }>();

export function allowRequest(ip: string): boolean {
  const now = Date.now();
  const w = windows.get(ip);
  if (!w || now - w.start > 60_000) {
    windows.set(ip, { start: now, count: 1 });
    return true;
  }
  w.count++;
  return w.count <= config.limits.requestsPerMinute;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, w] of windows) if (now - w.start > 120_000) windows.delete(ip);
}, 60_000).unref();
