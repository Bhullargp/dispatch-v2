'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

const SECURITY_QUESTIONS = [
  'What was the name of your first pet?',
  'What city were you born in?',
  'What was the name of your first school?',
  "What is your mother's maiden name?",
  'What was your first car?',
  'What is your favorite color?'
];

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [login, setLogin] = useState('admin');
  const [email, setEmail] = useState('admin@dispatch.local');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [answers, setAnswers] = useState(['', '', '']);
  const [selectedQ, setSelectedQ] = useState([0, 1, 2]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const signupQs = useMemo(
    () => selectedQ.map((idx, i) => ({ question: SECURITY_QUESTIONS[idx], answer: answers[i] })),
    [selectedQ, answers]
  );

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
        router.push('/dispatch');
        return;
      }

      if (mode === 'signup') {
        if (password !== confirmPassword) throw new Error('Passwords do not match');
        if (new Set(selectedQ).size !== 3) throw new Error('Pick 3 different questions');
        if (answers.some((a) => !a.trim())) throw new Error('Answer all 3 security questions');

        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: login, email, password, securityQuestions: signupQs })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Signup failed');
        setMode('signin');
        setSuccess('Account created. Sign in now.');
        setPassword('');
        setConfirmPassword('');
        return;
      }

      if (newPassword !== confirmNewPassword) throw new Error('Passwords do not match');
      if (answers.some((a) => !a.trim())) throw new Error('Answer all 3 security questions');

      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, answers, newPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reset failed');
      setMode('signin');
      setSuccess('Password reset successful. Sign in now.');
      setAnswers(['', '', '']);
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err: any) {
      setError(err.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-zinc-900/20 border border-zinc-900 rounded-[2.5rem] p-8 md:p-10">
        <h1 className="text-2xl font-black uppercase text-center text-white mb-6">Dispatch Login</h1>

        {mode !== 'reset' && (
          <div className="flex bg-zinc-900/50 rounded-xl p-1 mb-6">
            <button type="button" onClick={() => setMode('signin')} className={`flex-1 py-2 text-xs font-black uppercase rounded-lg ${mode === 'signin' ? 'bg-blue-600 text-white' : 'text-zinc-500'}`}>Sign In</button>
            <button type="button" onClick={() => setMode('signup')} className={`flex-1 py-2 text-xs font-black uppercase rounded-lg ${mode === 'signup' ? 'bg-blue-600 text-white' : 'text-zinc-500'}`}>Sign Up</button>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <input className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white" placeholder="Username" value={login} onChange={(e) => setLogin(e.target.value)} required={mode !== 'reset'} />
          <input className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required={mode !== 'signin'} type="email" />

          {mode !== 'reset' && <input type="password" className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />}

          {mode === 'signup' && (
            <>
              <input type="password" className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white" placeholder="Confirm Password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
              {selectedQ.map((val, i) => (
                <div key={i} className="space-y-2">
                  <select value={val} onChange={(e) => { const arr = [...selectedQ]; arr[i] = Number(e.target.value); setSelectedQ(arr); }} className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white">
                    {SECURITY_QUESTIONS.map((q, idx) => <option key={idx} value={idx}>{q}</option>)}
                  </select>
                  <input className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white" placeholder="Answer" value={answers[i]} onChange={(e) => { const arr = [...answers]; arr[i] = e.target.value; setAnswers(arr); }} required />
                </div>
              ))}
            </>
          )}

          {mode === 'reset' && (
            <>
              {SECURITY_QUESTIONS.slice(0, 3).map((q, i) => (
                <div key={i}>
                  <p className="text-xs text-zinc-400 mb-1">{q}</p>
                  <input className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white" placeholder="Answer" value={answers[i]} onChange={(e) => { const arr = [...answers]; arr[i] = e.target.value; setAnswers(arr); }} required />
                </div>
              ))}
              <input type="password" className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white" placeholder="New Password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
              <input type="password" className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white" placeholder="Confirm New Password" value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} required />
            </>
          )}

          {error && <div className="text-red-400 text-sm">{error}</div>}
          {success && <div className="text-green-400 text-sm">{success}</div>}

          <button className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black uppercase tracking-widest py-3 rounded-xl" type="submit" disabled={loading}>
            {loading ? 'Please wait...' : mode === 'signin' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Reset Password'}
          </button>

          {mode === 'signin' && <button type="button" className="w-full text-xs text-zinc-500" onClick={() => { setMode('reset'); setError(''); setSuccess(''); }}>Forgot Password?</button>}
          {mode === 'reset' && <button type="button" className="w-full text-xs text-zinc-500" onClick={() => { setMode('signin'); setError(''); setSuccess(''); }}>Back to Sign In</button>}
        </form>
      </div>
    </div>
  );
}
