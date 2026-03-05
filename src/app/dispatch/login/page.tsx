'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login, register, getSecurityQuestions } from '../auth';

export default function LoginPage() {
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  
  const [securityAnswers, setSecurityAnswers] = useState<{ question: string; answer: string }[]>([
    { question: '', answer: '' },
    { question: '', answer: '' }
  ]);
  const [selectedQuestions, setSelectedQuestions] = useState<number[]>([0, 1]);
  const [resetQuestionIndex, setResetQuestionIndex] = useState(0);
  const [resetAnswer, setResetAnswer] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const router = useRouter();
  const availableQuestions = getSecurityQuestions();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    await new Promise(resolve => setTimeout(resolve, 300));

    if (mode === 'signin') {
      const result = login(email, password);
      if (result) {
        router.push('/dispatch');
      } else {
        setError('Invalid email or password');
      }
    } else if (mode === 'signup') {
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        setLoading(false);
        return;
      }
      if (password.length < 4) {
        setError('Password must be at least 4 characters');
        setLoading(false);
        return;
      }
      if (!securityAnswers[0].answer || !securityAnswers[1].answer) {
        setError('Please answer both security questions');
        setLoading(false);
        return;
      }
      
      const result = register(email, password, securityAnswers);
      if (result.success) {
        setSuccess('Account created! Please sign in.');
        setMode('signin');
        setPassword('');
        setConfirmPassword('');
        setSecurityAnswers([{ question: '', answer: '' }, { question: '', answer: '' }]);
      } else {
        setError(result.error || 'Registration failed');
     (result.error || ' }
    } else if (mode === 'reset') {
      const { validateSecurityAnswer, resetPassword: resetPw } = await import('../auth');
      if (newPassword !== confirmNewPassword) {
        setError('Passwords do not match');
        setLoading(false);
        return;
      }
      if (newPassword.length < 4) {
        setError('Password must be at least 4 characters');
        setLoading(false);
        return;
      }
      
      const isValid = validateSecurityAnswer(email, resetQuestionIndex, resetAnswer);
      if (isValid) {
        const reset = resetPw(email, newPassword);
        if (reset) {
          setSuccess('Password reset! Please sign in with your new password.');
          setMode('signin');
          setNewPassword('');
          setConfirmNewPassword('');
          setResetAnswer('');
        } else {
          setError('Failed to reset password');
        }
      } else {
        setError('Invalid security answer');
      }
    }
    
    setLoading(false);
  };

  const handleQuestionChange = (index: number, qIndex: number) => {
    const newAnswers = [...securityAnswers];
    newAnswers[index] = { 
      ...newAnswers[index], 
      question: availableQuestions[qIndex] 
    };
    setSecurityAnswers(newAnswers);
    setSelectedQuestions(prev => {
      const newSelected = [...prev];
      newSelected[index] = qIndex;
      return newSelected;
    });
  };

  return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-6 shadow-[0_0_30px_rgba(37,99,235,0.4)]">
            <span className="text-2xl font-black">DM</span>
          </div>
          <h1 className="text-4xl font-black tracking-tighter uppercase text-white mb-2">Dispatch Master</h1>
          <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-[0.4em]">Fleet Logistics Command</p>
        </div>

        {mode !== 'reset' && (
          <div className="flex bg-zinc-900/50 rounded-xl p-1 mb-6">
            <button
              type="button"
              onClick={() => { setMode('signin'); setError(''); setSuccess(''); }}
              className={`flex-1 py-2 text-xs font-black uppercase tracking-widest rounded-lg transition-all ${
                mode === 'signin' ? 'bg-blue-600 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setMode('signup'); setError(''); setSuccess(''); }}
              className={`flex-1 py-2 text-xs font-black uppercase tracking-widest rounded-lg transition-all ${
                mode === 'signup' ? 'bg-blue-600 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Sign Up
            </button>
          </div>
        )}

        <div className="bg-zinc-900/20 border border-zinc-900 rounded-[2.5rem] overflow-hidden backdrop-blur-sm shadow-2xl p-8 md:p-10">
          <h2 className="text-xl font-black uppercase tracking-widest text-zinc-300 mb-6 text-center">
            {mode === 'signin' && 'Sign In'}
            {mode === 'signup' && 'Create Account'}
            {mode === 'reset' && 'Reset Password'}
          </h2>
          
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-5 py-4 text-white placeholder-zinc-600 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all font-medium"
                placeholder="your@email.com"
              />
            </div>

            {mode !== 'reset' && (
              <>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-5 py-4 text-white placeholder-zinc-600 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all font-medium"
                    placeholder="••••••••"
                  />
                </div>

                {mode === 'signup' && (
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3">
                      Confirm Password
                    </label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-5 py-4 text-white placeholder-zinc-600 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all font-medium"
                      placeholder="••••••••"
                    />
                  </div>
                )}
              </>
            )}

            {mode === 'signup' && (
              <div className="space-y-4 pt-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">
                  Security Questions (required)
                </p>
                
                <div>
                  <select
                    value={selectedQuestions[0]}
                    onChange={(e) => handleQuestionChange(0, parseInt(e.target.value))}
                    className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-600 transition-all font-medium text-sm mb-2"
                  >
                    {availableQuestions.map((q, i) => (
                      <option key={i} value={i} disabled={selectedQuestions[1] === i}>
                        {q}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={securityAnswers[0].answer}
                    onChange={(e) => {
                      const newAnswers = [...securityAnswers];
                      newAnswers[0].answer = e.target.value;
                      setSecurityAnswers(newAnswers);
                    }}
                    required
                    className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-5 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all font-medium text-sm"
                    placeholder="Your answer..."
                  />
                </div>

                <div>
                  <select
                    value={selectedQuestions[1]}
                    onChange={(e) => handleQuestionChange(1, parseInt(e.target.value))}
                    className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-600 transition-all font-medium text-sm mb-2"
                  >
                    {availableQuestions.map((q, i) => (
                      <option key={i} value={i} disabled={selectedQuestions[0] === i}>
                        {q}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={securityAnswers[1].answer}
                    onChange={(e) => {
                      const newAnswers = [...securityAnswers];
                      newAnswers[1].answer = e.target.value;
                      setSecurityAnswers(newAnswers);
                    }}
                    required
                    className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-5 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all font-medium text-sm"
                    placeholder="Your answer..."
                  />
                </div>
              </div>
            )}

            {mode === 'reset' && (
              <>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3">
                    Security Question
                  </label>
                  <p className="text-white text-sm mb-2">{availableQuestions[resetQuestionIndex]}</p>
                  <input
                    type="text"
                    value={resetAnswer}
                    onChange={(e) => setResetAnswer(e.target.value)}
                    required
                    className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-5 py-4 text-white placeholder-zinc-600 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all font-medium"
                    placeholder="Your answer"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3">
                    New Password
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-5 py-4 text-white placeholder-zinc-600 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all font-medium"
                    placeholder="••••••••"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3">
                    Confirm New Password
                  </label>
                  <input
                    type="password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    required
                    className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-5 py-4 text-white placeholder-zinc-600 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all font-medium"
                    placeholder="••••••••"
                  />
                </div>
              </>
            )}

            {error && (
              <div className="bg-red-950/30 border border-red-900/50 rounded-xl px-5 py-3 text-red-500 text-sm font-medium">
                {error}
              </div>
            )}

            {success && (
              <div className="bg-green-950/30 border border-green-900/50 rounded-xl px-5 py-3 text-green-500 text-sm font-medium">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-black uppercase tracking-widest py-4 rounded-xl border border-blue-700 transition-all shadow-[0_0_20px_rgba(37,99,235,0.3)] hover:shadow-[0_0_30px_rgba(37,99,235,0.5)] flex items-center justify-center gap-3"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>{mode === 'signin' ? 'Authenticating...' : 'Processing...'}</span>
                </>
              ) : (
                <>
                  {mode === 'signin' && 'Sign In'}
                  {mode === 'signup' && 'Create Account'}
                  {mode === 'reset' && 'Reset Password'}
                </>
              )}
            </button>

            {mode === 'signin' && (
              <button
                type="button"
                onClick={() => { setMode('reset'); setError(''); setSuccess(''); }}
                className="w-full text-center text-xs font-medium text-zinc-500 hover:text-blue-500 transition-colors py-2"
              >
                Forgot Password?
              </button>
            )}

            {mode === 'reset' && (
              <button
                type="button"
                onClick={() => { setMode('signin'); setError(''); setSuccess(''); }}
                className="w-full text-center text-xs font-medium text-zinc-500 hover:text-blue-500 transition-colors py-2"
              >
                Back to Sign In
              </button>
            )}
          </form>
        </div>

        <p className="mt-6 text-center text-[8px] font-black uppercase text-zinc-800 tracking-[1em]">
          Secure Environment
        </p>
      </div>
    </div>
  );
}
