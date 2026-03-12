// Simple auth utility for Dispatch Master
import { useState, useEffect } from 'react';

const AUTH_KEY = 'dm_auth';
const USERS_KEY = 'dm_users';
const RESET_MARKER_KEY = 'dm_auth_reset_v2';
const SESSION_DURATION = 60 * 60 * 1000; // 1 hour

interface AuthSession {
  email: string;
  loginTime: number;
}

interface User {
  email: string;
  passwordHash: string;
  securityAnswers: { question: string; answer: string }[];
  createdAt: number;
}

// Simple hash function (not secure for production, but works for demo)
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

function getUsers(): User[] {
  try {
    // One-time credential reset requested by Boss:
    // wipe saved auth/users from browser localStorage, then recreate primary admin.
    const resetDone = localStorage.getItem(RESET_MARKER_KEY);
    if (!resetDone) {
      localStorage.removeItem(AUTH_KEY);
      localStorage.removeItem(USERS_KEY);
      localStorage.setItem(RESET_MARKER_KEY, '1');
    }

    const raw = localStorage.getItem(USERS_KEY);
    const users = raw ? JSON.parse(raw) : [];

    // Ensure Boss primary admin credentials always exist
    const bossEmail = 'g@p.com';
    const bossPassword = 'karandeep';
    const existingBoss = users.find((u: User) => u.email.toLowerCase() === bossEmail.toLowerCase());

    if (!existingBoss) {
      users.push({
        email: bossEmail,
        passwordHash: simpleHash(bossPassword),
        securityAnswers: [
          { question: 'What city were you born in?', answer: 'test' },
          { question: 'What is your favorite color?', answer: 'blue' }
        ],
        createdAt: Date.now()
      });
    } else {
      // Force-sync Boss credentials on every load
      existingBoss.email = bossEmail;
      existingBoss.passwordHash = simpleHash(bossPassword);
    }

    localStorage.setItem(USERS_KEY, JSON.stringify(users));
    return users;
  } catch {
    return [];
  }
}

function saveUsers(users: User[]): void {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export function useAuth() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = () => {
      const session = getSession();
      setIsLoggedIn(!!session);
      setUser(session);
      setLoading(false);
    };
    checkAuth();
  }, []);

  const logout = () => {
    clearSession();
    setIsLoggedIn(false);
    setUser(null);
  };

  return { isLoggedIn, logout, user, loading };
}

export function register(
  email: string, 
  password: string, 
  securityAnswers: { question: string; answer: string }[]
): { success: boolean; error?: string } {
  const users = getUsers();
  
  if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return { success: false, error: 'User already exists' };
  }

  if (!securityAnswers || securityAnswers.length < 2) {
    return { success: false, error: 'Please answer both security questions' };
  }

  const newUser: User = {
    email: email.toLowerCase(),
    passwordHash: simpleHash(password),
    securityAnswers: securityAnswers.map(a => ({
      question: a.question,
      answer: a.answer.toLowerCase().trim()
    })),
    createdAt: Date.now()
  };

  users.push(newUser);
  saveUsers(users);
  
  return { success: true };
}

export function login(email: string, password: string): boolean {
  const users = getUsers();
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedPassword = password.trim();
  const user = users.find(u => u.email.toLowerCase() === normalizedEmail);

  if (!user) return false;

  if (user.passwordHash === simpleHash(normalizedPassword)) {
    const session: AuthSession = { email: user.email, loginTime: Date.now() };
    localStorage.setItem(AUTH_KEY, JSON.stringify(session));
    return true;
  }

  return false;
}

export function validateSecurityAnswer(
  email: string, 
  questionIndex: number, 
  answer: string
): boolean {
  const users = getUsers();
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  
  if (!user || !user.securityAnswers || user.securityAnswers.length <= questionIndex) {
    return false;
  }
  
  return user.securityAnswers[questionIndex].answer === answer.toLowerCase().trim();
}

export function resetPassword(email: string, newPassword: string): boolean {
  const users = getUsers();
  const userIndex = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
  
  if (userIndex === -1) return false;
  
  users[userIndex].passwordHash = simpleHash(newPassword);
  saveUsers(users);
  return true;
}

export function getSecurityQuestions(): string[] {
  return [
    "What was the name of your first pet?",
    "What city were you born in?",
    "What was the name of your first school?",
    "What is your mother's maiden name?",
    "What was your first car?"
  ];
}

export function isAuthenticated(): boolean {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return false;
    const session: AuthSession = JSON.parse(raw);
    if (Date.now() - session.loginTime > SESSION_DURATION) {
      localStorage.removeItem(AUTH_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function clearSession(): void {
  localStorage.removeItem(AUTH_KEY);
}

export function logout(): void {
  clearSession();
}

export function getSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const session: AuthSession = JSON.parse(raw);
    if (Date.now() - session.loginTime > SESSION_DURATION) {
      localStorage.removeItem(AUTH_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}
