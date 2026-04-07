import crypto from 'crypto';
import pool, { db } from '@/lib/db';

const SESSION_COOKIE = 'dispatch_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const AUTH_SECRET = process.env.DISPATCH_AUTH_SECRET || 'dispatch-dev-secret-change-me';

export type SessionPayload = {
  userId: number;
  username: string;
  email: string;
  role: string;
  mustChangePassword: boolean;
  exp: number;
};

export type SignupPayload = {
  username: string;
  email: string;
  password: string;
  securityQuestions: { question: string; answer: string }[];
  role?: string;
};

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromB64url(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  const padded = normalized + (pad ? '='.repeat(4 - pad) : '');
  return Buffer.from(padded, 'base64');
}

function sign(input: string): string {
  return b64url(crypto.createHmac('sha256', AUTH_SECRET).update(input).digest());
}

export function createSessionToken(payload: Omit<SessionPayload, 'exp'>): string {
  const body: SessionPayload = { ...payload, exp: Date.now() + SESSION_TTL_MS };
  const encoded = b64url(JSON.stringify(body));
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  const expected = sign(encoded);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  try {
    const payload = JSON.parse(fromB64url(encoded).toString('utf8')) as SessionPayload;
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function hashSecret(value: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(value, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifySecret(value: string, stored: string): boolean {
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(value, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export async function ensureDispatchAuthSchemaAndSeed() {
  // PG schema is already created - just ensure admin user exists
  const adminUsername = 'bhullargp';
  const adminEmail = 'bhullargp';
  const adminPassword = 'karandeep';
  const defaultSecurity = [
    { question: 'What was the name of your first pet?', answer: 'dispatch' },
    { question: 'What city were you born in?', answer: 'caledon' },
    { question: 'What was the name of your first school?', answer: 'dispatch' }
  ];

  const existingAdmin = await db().get(
    'SELECT id FROM users WHERE username = $1 OR email = $2',
    [adminUsername, adminEmail]
  ) as { id: number } | undefined;

  if (!existingAdmin) {
    const result = await db().run(
      `INSERT INTO users (
        username, email, password_hash, role,
        security_q1, security_a1_hash,
        security_q2, security_a2_hash,
        security_q3, security_a3_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        adminUsername,
        adminEmail,
        hashSecret(adminPassword),
        'admin',
        defaultSecurity[0].question,
        hashSecret(defaultSecurity[0].answer),
        defaultSecurity[1].question,
        hashSecret(defaultSecurity[1].answer),
        defaultSecurity[2].question,
        hashSecret(defaultSecurity[2].answer)
      ]
    );
    return { adminId: 1, sessionCookie: SESSION_COOKIE, sessionTtlMs: SESSION_TTL_MS };
  } else {
    await db().run(
      `UPDATE users
      SET password_hash = $1, role = $2,
          security_q1 = $3, security_a1_hash = $4,
          security_q2 = $5, security_a2_hash = $6,
          security_q3 = $7, security_a3_hash = $8,
          force_password_change = 0
      WHERE id = $9`,
      [
        hashSecret(adminPassword),
        'admin',
        defaultSecurity[0].question,
        hashSecret(defaultSecurity[0].answer),
        defaultSecurity[1].question,
        hashSecret(defaultSecurity[1].answer),
        defaultSecurity[2].question,
        hashSecret(defaultSecurity[2].answer),
        existingAdmin.id
      ]
    );
    return { adminId: existingAdmin.id, sessionCookie: SESSION_COOKIE, sessionTtlMs: SESSION_TTL_MS };
  }
}

export async function createUser(payload: SignupPayload) {
  await ensureDispatchAuthSchemaAndSeed();

  if (!payload.securityQuestions || payload.securityQuestions.length !== 3) {
    throw new Error('Exactly 3 security questions are required');
  }

  const normalizedSecurity = payload.securityQuestions.map((q) => ({
    question: String(q.question || '').trim(),
    answer: String(q.answer || '').trim(),
  }));

  if (normalizedSecurity.some((q) => !q.question || !q.answer)) {
    throw new Error('Security questions and answers cannot be empty');
  }
  if (normalizedSecurity.some((q) => q.answer.length < 3)) {
    throw new Error('Security answers must be at least 3 characters');
  }

  if (new Set(normalizedSecurity.map((q) => q.question.toLowerCase())).size !== 3) {
    throw new Error('Security questions must be unique');
  }

  const username = payload.username.trim().toLowerCase();
  const email = payload.email.trim().toLowerCase();

  const exists = await db().get(
    'SELECT id FROM users WHERE username = $1 OR email = $2',
    [username, email]
  );
  if (exists) throw new Error('User already exists');

  const result = await db().run(
    `INSERT INTO users (
      username, email, password_hash, role,
      security_q1, security_a1_hash,
      security_q2, security_a2_hash,
      security_q3, security_a3_hash
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      username,
      email,
      hashSecret(payload.password),
      payload.role || 'user',
      normalizedSecurity[0].question,
      hashSecret(normalizedSecurity[0].answer.toLowerCase()),
      normalizedSecurity[1].question,
      hashSecret(normalizedSecurity[1].answer.toLowerCase()),
      normalizedSecurity[2].question,
      hashSecret(normalizedSecurity[2].answer.toLowerCase())
    ]
  );

  return result.changes;
}

export async function findUserByLogin(login: string) {
  await ensureDispatchAuthSchemaAndSeed();
  const normalized = login.trim().toLowerCase();
  return await db().get(
    'SELECT * FROM users WHERE username = $1 OR email = $2',
    [normalized, normalized]
  ) as any;
}

export async function getUserByEmail(email: string) {
  await ensureDispatchAuthSchemaAndSeed();
  return await db().get(
    'SELECT * FROM users WHERE email = $1',
    [email.trim().toLowerCase()]
  ) as any;
}

export async function getSecurityQuestionsByEmail(email: string): Promise<string[] | null> {
  const user = await getUserByEmail(email);
  if (!user) return null;
  return [user.security_q1, user.security_q2, user.security_q3].map((q: string) => String(q || ''));
}

export async function resetPasswordBySecurityAnswers(email: string, answers: string[], newPassword: string) {
  const user = await getUserByEmail(email);
  if (!user) return false;
  if (!answers || answers.length !== 3) return false;

  const ok =
    verifySecret(answers[0].trim().toLowerCase(), user.security_a1_hash) &&
    verifySecret(answers[1].trim().toLowerCase(), user.security_a2_hash) &&
    verifySecret(answers[2].trim().toLowerCase(), user.security_a3_hash);

  if (!ok) return false;

  await db().run(
    `UPDATE users
    SET password_hash = $1,
        force_password_change = 0,
        last_password_reset_at = datetime('now')
    WHERE id = $2`,
    [hashSecret(newPassword), user.id]
  );
  return true;
}

export const authConfig = {
  sessionCookie: SESSION_COOKIE,
  secureCookie: process.env.COOKIE_SECURE === 'true',
  sessionTtlMs: SESSION_TTL_MS
};
