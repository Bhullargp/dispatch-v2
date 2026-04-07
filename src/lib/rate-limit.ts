// Simple in-memory rate limiter for login attempts
export const attempts = new Map<string, { count: number; lockedUntil: number }>();

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export function checkLoginRateLimit(ip: string): { allowed: boolean; remainingMs?: number } {
  const entry = attempts.get(ip);
  const now = Date.now();

  if (entry && entry.lockedUntil > now) {
    return { allowed: false, remainingMs: entry.lockedUntil - now };
  }

  if (entry && entry.lockedUntil <= now) {
    attempts.delete(ip); // Lockout expired, reset
  }

  return { allowed: true };
}

export function recordFailedAttempt(ip: string): { lockedOut: boolean; remainingMs?: number } {
  const entry = attempts.get(ip) || { count: 0, lockedUntil: 0 };
  entry.count += 1;

  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MINUTES * 60 * 1000;
    entry.count = 0;
    attempts.set(ip, entry);
    return { lockedOut: true, remainingMs: LOCKOUT_MINUTES * 60 * 1000 };
  }

  attempts.set(ip, entry);
  return { lockedOut: false };
}

export function resetLoginAttempts(ip: string) {
  attempts.delete(ip);
}

// Clean up old entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of attempts) {
    if (entry.lockedUntil <= now) attempts.delete(ip);
  }
}, 10 * 60 * 1000);
