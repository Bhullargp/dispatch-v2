import React from 'react';
import Database from 'better-sqlite3';
import path from 'path';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { getServerAccess } from '@/lib/ownership';
import { ensureUploadSchema } from '@/lib/pdf-processing';
import UploadJobActions from './UploadJobActions';
import RunUploadWorkerButton from './RunUploadWorkerButton';
import AdminUserPasswordReset from './AdminUserPasswordReset';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');

export default async function AdminInspectionPage() {
  ensureDispatchAuthSchemaAndSeed();
  const access = await getServerAccess();
  if (!access) redirect('/dispatch/login');
  if (access.mustChangePassword) redirect('/dispatch/login?forcePasswordChange=1');
  if (!access.isAdmin) redirect('/dispatch');

  const db = new Database(dbPath);
  ensureUploadSchema(db);

  const users = db.prepare(`
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
  `).all() as Array<any>;

  const recentUploadJobs = db.prepare(`
    SELECT id, user_id, original_filename, status, trip_number, error_message, attempt_count, max_attempts, created_at
    FROM upload_jobs
    ORDER BY id DESC
    LIMIT 25
  `).all() as Array<any>;

  const totalTrips = db.prepare('SELECT COUNT(*) as c FROM trips').get() as { c: number };
  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100 p-6 md:p-10">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-3xl font-black uppercase">Admin Inspection</h1>
          <div className="flex items-center gap-2">
            <RunUploadWorkerButton />
            <Link href="/dispatch" className="text-xs font-black uppercase bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 px-4 py-2 rounded-xl">← Back to Dispatch</Link>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-4">
            <p className="text-xs text-zinc-500 uppercase">Total Users</p>
            <p className="text-3xl font-black text-blue-400">{totalUsers.c}</p>
          </div>
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-4">
            <p className="text-xs text-zinc-500 uppercase">Total Trips</p>
            <p className="text-3xl font-black text-green-400">{totalTrips.c}</p>
          </div>
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-4">
            <p className="text-xs text-zinc-500 uppercase">Recent Upload Jobs</p>
            <p className="text-3xl font-black text-purple-400">{recentUploadJobs.length}</p>
          </div>
        </div>

        <section className="bg-zinc-900/20 border border-zinc-800 rounded-2xl p-4 overflow-auto">
          <h2 className="text-xs uppercase font-black tracking-widest text-zinc-500 mb-3">Users</h2>
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500 text-xs uppercase">
              <tr>
                <th className="py-2">User</th><th>Email</th><th>Role</th><th className="text-right">Trips</th><th className="text-right">Uploads</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-zinc-800">
                  <td className="py-2 font-mono">{u.username}</td>
                  <td>{u.email}</td>
                  <td><span className={`px-2 py-1 rounded text-xs ${u.role === 'admin' ? 'bg-blue-900/40 text-blue-300' : 'bg-zinc-800 text-zinc-300'}`}>{u.role}</span></td>
                  <td className="text-right">{u.trip_count}</td>
                  <td className="text-right">{u.upload_count}</td>
                  <td>
                    <AdminUserPasswordReset userId={u.id} username={u.username} isSelf={u.id === access.session.userId} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="bg-zinc-900/20 border border-zinc-800 rounded-2xl p-4 overflow-auto">
          <h2 className="text-xs uppercase font-black tracking-widest text-zinc-500 mb-3">Recent Upload Jobs</h2>
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500 text-xs uppercase">
              <tr>
                <th className="py-2">#</th><th>User</th><th>File</th><th>Status</th><th>Attempts</th><th>Trip</th><th>Error</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {recentUploadJobs.map((job) => (
                <tr key={job.id} className="border-t border-zinc-800">
                  <td className="py-2 font-mono">{job.id}</td>
                  <td>{job.user_id}</td>
                  <td className="max-w-[220px] truncate">{job.original_filename}</td>
                  <td className={job.status === 'done' ? 'text-green-400' : job.status === 'failed' ? 'text-red-400' : job.status === 'cancelled' ? 'text-zinc-500' : 'text-yellow-400'}>{job.status}</td>
                  <td className="font-mono text-xs">{job.attempt_count}/{job.max_attempts}</td>
                  <td>{job.trip_number || '—'}</td>
                  <td className="max-w-[280px] truncate text-zinc-500">{job.error_message || '—'}</td>
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
