'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

const SECURITY_QUESTIONS = [
  'What is your truck number?',
  'What city were you born in?',
  "What is your mother's maiden name?",
  'What was the name of your first pet?',
  'What elementary school did you attend?',
  'What is your favorite truck stop?',
  'What highway do you drive most often?',
  'What was your first trucking company?',
  'What is your favorite food?',
  'What year did you start driving truck?',
];

type ResetStep = 'email' | 'questions' | 'done';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset' | 'force-change'>('signin');
  const [login, setLogin] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [answers, setAnswers] = useState(['', '', '']);
  const [selectedQ, setSelectedQ] = useState([0, 1, 2]);
  const [resetQuestions, setResetQuestions] = useState<string[]>([]);
  const [resetStep, setResetStep] = useState<ResetStep>('email');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const signupQs = useMemo(
    () => selectedQ.map((idx, i) => ({ question: SECURITY_QUESTIONS[idx], answer: answers[i].trim() })),
    [selectedQ, answers]
  );

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('forcePasswordChange') === '1') {
      setMode('force-change');
      setSuccess('Password change is required before continuing.');
      setError('');
    }
  }, []);

  const validateSignup = () => {
    if (!login.trim()) throw new Error('Username or Email is required');
    if (password.length < 8) throw new Error('Password must be at least 8 characters');
    if (password !== confirmPassword) throw new Error('Passwords do not match');
    if (selectedQ.length !== 3) throw new Error('Please select exactly 3 questions');
    if (new Set(selectedQ).size !== 3) throw new Error('Please select 3 different security questions');
    if (signupQs.some((q) => !q.answer)) throw new Error('Please answer all 3 security questions');
      if (signupQs.some((q) => q.answer.length < 3)) throw new Error('Security answers must be at least 3 characters');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (mode === 'signin') {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ login, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Login failed');
        if (data?.user?.mustChangePassword) {
          setMode('force-change');
          setCurrentPassword(password);
          setNewPassword('');
          setConfirmNewPassword('');
          setSuccess('Your password was reset by an admin. Set a new password to continue.');
          return;
        }
        router.push('/dispatch');
        return;
      }

      if (mode === 'force-change') {
        if (!currentPassword) throw new Error('Current temporary password is required');
        if (newPassword.length < 8) throw new Error('New password must be at least 8 characters');
        if (newPassword !== confirmNewPassword) throw new Error('New passwords do not match');

        const res = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Password change failed');
        router.push('/dispatch');
        return;
      }

      if (mode === 'signup') {
        validateSignup();
        const loginVal = login.trim();
        const isEmail = loginVal.includes('@');
        const signupEmail = isEmail ? loginVal : `${loginVal}@dispatch.local`;
        const signupUsername = isEmail ? loginVal.split('@')[0] : loginVal;
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: signupUsername, email: signupEmail, password, securityQuestions: signupQs })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Signup failed');
        setMode('signin');
        setSuccess('Account created. Sign in now.');
        setPassword('');
        setConfirmPassword('');
        setAnswers(['', '', '']);
        return;
      }

      if (resetStep === 'email') {
        if (!email.trim()) throw new Error('Email is required');
        const res = await fetch(`/api/auth/forgot-password?email=${encodeURIComponent(email.trim())}`, { method: 'GET' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not find account');
        if (!Array.isArray(data.questions) || data.questions.length !== 3) {
          throw new Error('Security questions are not set up for this account');
        }
        setResetQuestions(data.questions);
        setResetStep('questions');
        setSuccess('Security questions loaded. Answer them to reset your password.');
        return;
      }

      if (newPassword.length < 8) throw new Error('New password must be at least 8 characters');
      if (newPassword !== confirmNewPassword) throw new Error('New passwords do not match');
      if (answers.some((a) => !a.trim())) throw new Error('Please answer all 3 security questions');
      if (answers.some((a) => a.trim().length < 3)) throw new Error('Security answers must be at least 3 characters');

      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), answers, newPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reset failed');
      setMode('signin');
      setResetStep('done');
      setSuccess('Password reset successful. Sign in with your new password.');
      setAnswers(['', '', '']);
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err: any) {
      setError(err.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const setQuestionIndex = (questionSlot: number, nextValue: number) => {
    const next = [...selectedQ];
    next[questionSlot] = nextValue;
    setSelectedQ(next);
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 overflow-hidden">
      {/* Animated background */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-zinc-950" />
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full opacity-[0.08]" style={{ background: 'radial-gradient(ellipse, rgba(16,185,129,0.4) 0%, transparent 70%)', filter: 'blur(80px)' }} />
        <div className="absolute bottom-0 -right-40 w-[500px] h-[400px] rounded-full opacity-[0.06]" style={{ background: 'radial-gradient(ellipse, rgba(16,185,129,0.4) 0%, transparent 70%)', filter: 'blur(80px)' }} />
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
      </div>
      
      <div className="relative z-10 w-full max-w-md">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-600/10 border border-emerald-500/20 mb-4">
            <span className="text-3xl">🚛</span>
          </div>
          <h1 className="text-3xl font-black uppercase tracking-tighter text-white">Dispatch</h1>
          <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-600 mt-1">Fleet Management</p>
        </div>
        
        <div className="bg-zinc-900/40 backdrop-blur-xl border border-zinc-800/60 rounded-3xl p-8 md:p-10 shadow-[0_0_80px_rgba(16,185,129,0.03)]">

        {mode !== 'reset' && mode !== 'force-change' && (
          <div className="flex bg-zinc-900/50 rounded-xl p-1 mb-6">
            <button type="button" onClick={() => setMode('signin')} className={`flex-1 py-2 text-xs font-black uppercase rounded-lg ${mode === 'signin' ? 'bg-emerald-600 text-white' : 'text-zinc-500'}`}>Sign In</button>
            <button type="button" onClick={() => setMode('signup')} className={`flex-1 py-2 text-xs font-black uppercase rounded-lg ${mode === 'signup' ? 'bg-emerald-600 text-white' : 'text-zinc-500'}`}>Sign Up</button>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          {mode !== 'reset' && mode !== 'force-change' && (
            <input className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white" placeholder="Username or Email" value={login} onChange={(e) => setLogin(e.target.value)} required />
          )}

          {mode === 'reset' && resetStep === 'email' && (
            <input className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required type="email" />
          )}

          {mode === 'signin' && <input type="password" className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />}

          {mode === 'signup' && (
            <>
              <input type="password" className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <input type="password" className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white" placeholder="Confirm Password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
              <p className="text-xs text-zinc-500">Choose exactly 3 unique security questions.</p>
              {selectedQ.map((val, i) => {
                const duplicate = selectedQ.filter((q) => q === val).length > 1;
                return (
                  <div key={i} className="space-y-2">
                    <select
                      value={val}
                      onChange={(e) => setQuestionIndex(i, Number(e.target.value))}
                      className={`w-full bg-zinc-900/50 border ${duplicate ? 'border-red-500' : 'border-zinc-800'} rounded-xl px-4 py-3 text-white`}
                    >
                      {SECURITY_QUESTIONS.map((q, idx) => <option key={idx} value={idx}>{q}</option>)}
                    </select>
                    <input className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white" placeholder={`Answer #${i + 1}`} value={answers[i]} onChange={(e) => { const arr = [...answers]; arr[i] = e.target.value; setAnswers(arr); }} required />
                    {duplicate && <p className="text-xs text-red-400">This question is duplicated. Pick a different one.</p>}
                  </div>
                );
              })}
            </>
          )}

          {mode === 'reset' && (
            <>
              <div className="text-xs text-zinc-500 bg-zinc-900/40 border border-zinc-800 rounded-xl px-4 py-3">
                Step {resetStep === 'email' ? '1' : '2'} of 2 — {resetStep === 'email' ? 'Find your account' : 'Verify answers and set new password'}
              </div>

              {resetStep === 'email' && (
                <p className="text-xs text-zinc-400">Enter your account email to load your saved security questions.</p>
              )}

              {resetStep === 'questions' && (
                <>
                  {resetQuestions.map((q, i) => (
                    <div key={i}>
                      <p className="text-xs text-zinc-400 mb-1">{q}</p>
                      <input className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white" placeholder="Answer" value={answers[i]} onChange={(e) => { const arr = [...answers]; arr[i] = e.target.value; setAnswers(arr); }} required />
                    </div>
                  ))}
                  <input type="password" className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white" placeholder="New Password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
                  <input type="password" className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white" placeholder="Confirm New Password" value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} required />
                </>
              )}
            </>
          )}

          {mode === 'force-change' && (
            <>
              <div className="text-xs text-amber-300 bg-amber-900/20 border border-amber-700 rounded-xl px-4 py-3">
                Password change required before continuing.
              </div>
              <input type="password" className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white" placeholder="Current temporary password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
              <input type="password" className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white" placeholder="New Password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
              <input type="password" className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white" placeholder="Confirm New Password" value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} required />
            </>
          )}

          {error && <div className="text-red-400 text-xs font-bold bg-red-900/20 border border-red-800/30 rounded-xl p-3">{error}</div>}
          {success && <div className="text-green-400 text-xs font-bold bg-green-900/20 border border-green-800/30 rounded-xl p-3">{success}</div>}

          <button className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest py-3.5 rounded-xl disabled:opacity-70 transition-all shadow-[0_0_20px_rgba(16,185,129,0.15)]" type="submit" disabled={loading}>
            {loading ? 'Please wait...' : mode === 'signin' ? 'Sign In' : mode === 'signup' ? 'Create Account' : mode === 'force-change' ? 'Update Password' : resetStep === 'email' ? 'Continue' : 'Reset Password'}
          </button>

          {mode === 'signin' && <button type="button" className="w-full text-xs text-zinc-500" onClick={() => { setMode('reset'); setResetStep('email'); setResetQuestions([]); setAnswers(['', '', '']); setError(''); setSuccess(''); }}>Forgot Password?</button>}
          {mode === 'reset' && (
            <button
              type="button"
              className="w-full text-xs text-zinc-500"
              onClick={() => {
                if (resetStep === 'questions') {
                  setResetStep('email');
                  setResetQuestions([]);
                  setAnswers(['', '', '']);
                  setNewPassword('');
                  setConfirmNewPassword('');
                  setError('');
                  setSuccess('');
                  return;
                }
                setMode('signin');
                setError('');
                setSuccess('');
              }}
            >
              {resetStep === 'questions' ? 'Back to Email Step' : 'Back to Sign In'}
            </button>
          )}
        </form>
        </div>
      </div>
    </div>
  );
}
