export const dynamic = 'force-dynamic';

import React from 'react';
import { db } from '@/lib/db';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { getServerAccess } from '@/lib/ownership';
import UploadJobActions from './UploadJobActions';
import RunUploadWorkerButton from './RunUploadWorkerButton';
import AdminUserPasswordReset from './AdminUserPasswordReset';
import AdminLlmSettings from './AdminLlmSettings';

export default async function AdminInspectionPage() {
  await ensureDispatchAuthSchemaAndSeed();
  const access = await getServerAccess();
  if (!access) redirect('/dispatch/login');
  if (access.mustChangePassword) redirect('/dispatch/login?forcePasswordChange=1');
  if (!access.isAdmin) redirect('/dispatch');

  const users = await db().query(`
    SELECT
      u.id,
      u.username,
      u.email,
      u.role,
      u.created_at,
      COUNT(DISTINCT t.trip_number) AS trip_count,
      COUNT(DISTINCT uj.id) AS upload_count
    FROM users u
    LEFT JOIN trips t ON t.user_id = u.id
    LEFT JOIN upload_jobs uj ON uj.user_id = u.id
    GROUP BY u.id, u.username, u.email, u.role, u.created_at
    ORDER BY u.role DESC, u.created_at DESC
    LIMIT 100
  `, []) as Array<any>;

  const recentUploadJobs = await db().query(`
    SELECT id, user_id, original_filename, status, trip_number, error_message, attempt_count, max_attempts, created_at
    FROM upload_jobs
    ORDER BY id DESC
    LIMIT 25
  `, []) as Array<any>;

  const totalTrips = await db().get('SELECT COUNT(*) as c FROM trips', []) as { c: number };
  const totalUsers = await db().get('SELECT COUNT(*) as c FROM users', []) as { c: number };
  const pendingJobs = await db().get("SELECT COUNT(*) as c FROM upload_jobs WHERE status IN ('queued','processing')", []) as { c: number };

  const statusColors: Record<string, string> = {
    done: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
    failed: 'bg-red-500/15 text-red-400 border border-red-500/30',
    cancelled: 'bg-zinc-700/30 text-zinc-500 border border-zinc-700/30',
    queued: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
    processing: 'bg-blue-500/15 text-blue-400 border border-blue-500/30',
  };

  return (
    <div className="min-h-screen text-zinc-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 pt-2">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-black mb-1">System</p>
            <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tight">
              <span className="bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">Admin</span>
              <span className="text-zinc-600 mx-2">·</span>
              <span className="bg-gradient-to-r from-emerald-400 to-emerald-600 bg-clip-text text-transparent">Control Panel</span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <RunUploadWorkerButton />
            <Link href="/dispatch" className="text-xs font-black uppercase bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-800 px-4 py-2 rounded-xl transition-all">
              ← Dispatch
            </Link>
          </div>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-gradient-to-br from-emerald-950/60 to-zinc-950 border border-emerald-800/40 rounded-2xl p-4 shadow-[0_0_30px_rgba(5,150,105,0.08)]">
            <p className="text-[10px] uppercase tracking-widest text-emerald-600 font-black mb-1">Users</p>
            <p className="text-3xl font-black text-emerald-400">{totalUsers.c}</p>
          </div>
          <div className="bg-gradient-to-br from-blue-950/40 to-zinc-950 border border-blue-800/30 rounded-2xl p-4 shadow-[0_0_30px_rgba(59,130,246,0.06)]">
            <p className="text-[10px] uppercase tracking-widest text-blue-600 font-black mb-1">Total Trips</p>
            <p className="text-3xl font-black text-blue-400">{totalTrips.c}</p>
          </div>
          <div className={`rounded-2xl p-4 ${(pendingJobs.c > 0) ? 'bg-gradient-to-br from-amber-950/40 to-zinc-950 border border-amber-800/30 shadow-[0_0_30px_rgba(245,158,11,0.06)]' : 'bg-zinc-900/30 border border-zinc-800'}`}>
            <p className={`text-[10px] uppercase tracking-widest font-black mb-1 ${(pendingJobs.c > 0) ? 'text-amber-600' : 'text-zinc-600'}`}>Queue</p>
            <p className={`text-3xl font-black ${(pendingJobs.c > 0) ? 'text-amber-400' : 'text-zinc-500'}`}>{pendingJobs.c}</p>
          </div>
        </div>

        {/* AI / LLM Settings */}
        <section className="bg-zinc-900/30 border border-zinc-800/60 rounded-3xl p-6 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-sm">🤖</div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-purple-500 font-black">AI Engine</p>
              <p className="text-sm font-black text-white">LLM Settings</p>
            </div>
          </div>
          <AdminLlmSettings />
        </section>

        {/* Users */}
        <section className="bg-zinc-900/30 border border-zinc-800/60 rounded-3xl p-5 backdrop-blur-sm overflow-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-xs">👥</div>
            <p className="text-xs uppercase font-black tracking-widest text-zinc-400">Users</p>
          </div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-zinc-600 border-b border-zinc-800">
                <th className="pb-2 font-black">Username</th>
                <th className="pb-2 font-black">Email</th>
                <th className="pb-2 font-black">Role</th>
                <th className="pb-2 font-black text-right">Trips</th>
                <th className="pb-2 font-black text-right">Uploads</th>
                <th className="pb-2 font-black">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors">
                  <td className="py-2.5 font-mono text-zinc-200 font-bold">{u.username}</td>
                  <td className="text-zinc-500 text-xs">{u.email || '—'}</td>
                  <td>
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                      u.role === 'admin'
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-zinc-800/60 text-zinc-400 border border-zinc-700/40'
                    }`}>{u.role}</span>
                  </td>
                  <td className="text-right font-mono text-zinc-400">{u.trip_count}</td>
                  <td className="text-right font-mono text-zinc-400">{u.upload_count}</td>
                  <td>
                    <AdminUserPasswordReset userId={u.id} username={u.username} isSelf={u.id === access.session.userId} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Upload Queue */}
        <section className="bg-zinc-900/30 border border-zinc-800/60 rounded-3xl p-5 backdrop-blur-sm overflow-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-7 h-7 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-xs">📋</div>
            <p className="text-xs uppercase font-black tracking-widest text-zinc-400">Recent Upload Jobs</p>
          </div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-zinc-600 border-b border-zinc-800">
                <th className="pb-2 font-black">#</th>
                <th className="pb-2 font-black">User</th>
                <th className="pb-2 font-black">File</th>
                <th className="pb-2 font-black">Status</th>
                <th className="pb-2 font-black">Attempts</th>
                <th className="pb-2 font-black">Trip</th>
                <th className="pb-2 font-black">Error</th>
                <th className="pb-2 font-black">Actions</th>
              </tr>
            </thead>
            <tbody>
              {recentUploadJobs.map((job) => (
                <tr key={job.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors">
                  <td className="py-2.5 font-mono text-zinc-500 text-xs">{job.id}</td>
                  <td className="font-mono text-zinc-400 text-xs">{job.user_id}</td>
                  <td className="max-w-[200px] truncate text-zinc-300 text-xs">{job.original_filename}</td>
                  <td>
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${statusColors[job.status] || 'bg-zinc-800 text-zinc-400'}`}>
                      {job.status}
                    </span>
                  </td>
                  <td className="font-mono text-xs text-zinc-500">{job.attempt_count}/{job.max_attempts}</td>
                  <td className="font-mono text-xs text-emerald-500">{job.trip_number || '—'}</td>
                  <td className="max-w-[240px] truncate text-xs text-red-500/70">{job.error_message || '—'}</td>
                  <td><UploadJobActions id={job.id} status={job.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

      </div>
    </div>
  );
}
