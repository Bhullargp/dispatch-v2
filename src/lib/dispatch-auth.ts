import crypto from 'crypto';
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');
const SESSION_COOKIE = 'dispatch_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const AUTH_SECRET = process.env.DISPATCH_AUTH_SECRET || 'dispatch-dev-secret-change-me';

export type SessionPayload = {
  userId: number;
  username: string;
  email: string;
  role: string;
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

export function getDb() {
  return new Database(dbPath);
}

export function ensureDispatchAuthSchemaAndSeed() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      security_q1 TEXT NOT NULL,
      security_a1_hash TEXT NOT NULL,
      security_q2 TEXT NOT NULL,
      security_a2_hash TEXT NOT NULL,
      security_q3 TEXT NOT NULL,
      security_a3_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const tripColumns = db.prepare(`PRAGMA table_info(trips)`).all() as Array<{ name: string }>;
  const hasUserId = tripColumns.some((c) => c.name === 'user_id');
  if (!hasUserId) {
    db.exec('ALTER TABLE trips ADD COLUMN user_id INTEGER REFERENCES users(id)');
  }

  const adminEmail = 'admin@dispatch.local';
  const adminUsername = 'admin';
  const adminPassword = 'karandeep@007';
  const defaultSecurity = [
    { question: 'What was the name of your first pet?', answer: 'dispatch' },
    { question: 'What city were you born in?', answer: 'caledon' },
    { question: 'What was the name of your first school?', answer: 'dispatch' }
  ];

  const existingAdmin = db
    .prepare('SELECT id FROM users WHERE username = ? OR email = ?')
    .get(adminUsername, adminEmail) as { id: number } | undefined;

  let adminId: number;
  if (!existingAdmin) {
    const result = db
      .prepare(`
        INSERT INTO users (
          username, email, password_hash, role,
          security_q1, security_a1_hash,
          security_q2, security_a2_hash,
          security_q3, security_a3_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
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
      );
    adminId = Number(result.lastInsertRowid);
  } else {
    adminId = existingAdmin.id;
    db.prepare(`
      UPDATE users
      SET password_hash = ?, role = ?,
          security_q1 = ?, security_a1_hash = ?,
          security_q2 = ?, security_a2_hash = ?,
          security_q3 = ?, security_a3_hash = ?
      WHERE id = ?
    `).run(
      hashSecret(adminPassword),
      'admin',
      defaultSecurity[0].question,
      hashSecret(defaultSecurity[0].answer),
      defaultSecurity[1].question,
      hashSecret(defaultSecurity[1].answer),
      defaultSecurity[2].question,
      hashSecret(defaultSecurity[2].answer),
      adminId
    );
  }

  db.prepare('UPDATE trips SET user_id = ? WHERE user_id IS NULL').run(adminId);

  return { adminId, sessionCookie: SESSION_COOKIE, sessionTtlMs: SESSION_TTL_MS };
}

export function createUser(payload: SignupPayload) {
  const db = getDb();
  ensureDispatchAuthSchemaAndSeed();

  if (!payload.securityQuestions || payload.securityQuestions.length !== 3) {
    throw new Error('Exactly 3 security questions are required');
  }

  const username = payload.username.trim().toLowerCase();
  const email = payload.email.trim().toLowerCase();

  const exists = db
    .prepare('SELECT id FROM users WHERE username = ? OR email = ?')
    .get(username, email);
  if (exists) throw new Error('User already exists');

  const result = db
    .prepare(`
      INSERT INTO users (
        username, email, password_hash, role,
        security_q1, security_a1_hash,
        security_q2, security_a2_hash,
        security_q3, security_a3_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      username,
      email,
      hashSecret(payload.password),
      payload.role || 'user',
      payload.securityQuestions[0].question,
      hashSecret(payload.securityQuestions[0].answer.trim().toLowerCase()),
      payload.securityQuestions[1].question,
      hashSecret(payload.securityQuestions[1].answer.trim().toLowerCase()),
      payload.securityQuestions[2].question,
      hashSecret(payload.securityQuestions[2].answer.trim().toLowerCase())
    );

  return Number(result.lastInsertRowid);
}

export function findUserByLogin(login: string) {
  const db = getDb();
  ensureDispatchAuthSchemaAndSeed();
  const normalized = login.trim().toLowerCase();
  return db
    .prepare('SELECT * FROM users WHERE username = ? OR email = ?')
    .get(normalized, normalized) as any;
}

export function getUserByEmail(email: string) {
  const db = getDb();
  ensureDispatchAuthSchemaAndSeed();
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase()) as any;
}

export function resetPasswordBySecurityAnswers(email: string, answers: string[], newPassword: string) {
  const user = getUserByEmail(email);
  if (!user) return false;
  if (!answers || answers.length !== 3) return false;

  const ok =
    verifySecret(answers[0].trim().toLowerCase(), user.security_a1_hash) &&
    verifySecret(answers[1].trim().toLowerCase(), user.security_a2_hash) &&
    verifySecret(answers[2].trim().toLowerCase(), user.security_a3_hash);

  if (!ok) return false;

  const db = getDb();
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashSecret(newPassword), user.id);
  return true;
}

export const authConfig = {
  sessionCookie: SESSION_COOKIE,
  secureCookie: process.env.NODE_ENV === 'production',
  sessionTtlMs: SESSION_TTL_MS
};
