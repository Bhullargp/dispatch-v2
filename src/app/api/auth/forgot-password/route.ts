import { NextResponse } from 'next/server';
import {
  ensureDispatchAuthSchemaAndSeed,
  getSecurityQuestionsByEmail,
  resetPasswordBySecurityAnswers,
} from '@/lib/dispatch-auth';

type ResetAttemptWindow = {
  attempts: number;
  firstAttemptAt: number;
  blockedUntil?: number;
};

const attemptStore = new Map<string, ResetAttemptWindow>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;

function getAttemptKey(email: string) {
  return email.trim().toLowerCase();
}

function readRateLimit(email: string): ResetAttemptWindow {
  const key = getAttemptKey(email);
  const now = Date.now();
  const current = attemptStore.get(key);

  if (!current) {
    const next = { attempts: 0, firstAttemptAt: now };
    attemptStore.set(key, next);
    return next;
  }

  if (current.blockedUntil && current.blockedUntil <= now) {
    const reset = { attempts: 0, firstAttemptAt: now };
    attemptStore.set(key, reset);
    return reset;
  }

  if (now - current.firstAttemptAt > WINDOW_MS) {
    const reset = { attempts: 0, firstAttemptAt: now };
    attemptStore.set(key, reset);
    return reset;
  }

  return current;
}

function registerFailedAttempt(email: string) {
  const key = getAttemptKey(email);
  const entry = readRateLimit(email);
  const attempts = entry.attempts + 1;
  const next: ResetAttemptWindow = { ...entry, attempts };

  if (attempts >= MAX_ATTEMPTS) {
    next.blockedUntil = Date.now() + BLOCK_MS;
  }

  attemptStore.set(key, next);
  return next;
}

function clearAttempts(email: string) {
  attemptStore.delete(getAttemptKey(email));
}

function getBlockRemainingMs(email: string): number {
  const state = readRateLimit(email);
  if (!state.blockedUntil) return 0;
  return Math.max(0, state.blockedUntil - Date.now());
}

export async function GET(request: Request) {
  try {
    ensureDispatchAuthSchemaAndSeed();
    const email = new URL(request.url).searchParams.get('email')?.trim().toLowerCase() || '';

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const questions = getSecurityQuestionsByEmail(email);
    if (!questions) {
      return NextResponse.json({ error: 'No account found for this email' }, { status: 404 });
    }

    return NextResponse.json({ questions });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Could not load security questions' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    ensureDispatchAuthSchemaAndSeed();
    const body = await request.json();

    const email = String(body.email || '').trim().toLowerCase();
    const answers: string[] = Array.isArray(body.answers) ? body.answers.map((a: unknown) => String(a || '')) : [];
    const newPassword = String(body.newPassword || '');

    if (!email || answers.length !== 3 || !newPassword) {
      return NextResponse.json({ error: 'Email, 3 answers, and new password are required' }, { status: 400 });
    }

    if (answers.some((answer) => !answer.trim())) {
      return NextResponse.json({ error: 'Please answer all 3 security questions' }, { status: 400 });
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const blockedForMs = getBlockRemainingMs(email);
    if (blockedForMs > 0) {
      const retryAfter = Math.ceil(blockedForMs / 1000);
      return NextResponse.json(
        { error: 'Too many reset attempts. Please try again later.', retryAfter },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }

    const ok = resetPasswordBySecurityAnswers(email, answers, newPassword);
    if (!ok) {
      const state = registerFailedAttempt(email);
      const attemptsRemaining = Math.max(0, MAX_ATTEMPTS - state.attempts);
      return NextResponse.json(
        {
          error: attemptsRemaining === 0
            ? 'Too many failed attempts. Please try again later.'
            : `Invalid email or security answers. ${attemptsRemaining} attempt(s) remaining.`,
        },
        { status: attemptsRemaining === 0 ? 429 : 401 }
      );
    }

    clearAttempts(email);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Reset failed' }, { status: 500 });
  }
}
