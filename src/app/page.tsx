import fs from 'fs';
import path from 'path';
import Link from 'next/link';

const WORKSPACE_PATH = '/Users/gurneet/.openclaw/workspace';

export default async function Page() {
  const memoryFiles = fs.readdirSync(path.join(WORKSPACE_PATH, 'memory'))
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse();

  const longTermMemory = fs.readFileSync(path.join(WORKSPACE_PATH, 'MEMORY.md'), 'utf-8');

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-8">
      <header className="mb-12 border-b border-slate-700 pb-6 flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-bold mb-2">🧠 Second Brain</h1>
          <p className="text-slate-400">Memory, Tasks & Documents</p>
        </div>
        <Link href="/dispatch" className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold shadow-lg transform hover:-translate-y-1 transition-all">
          🚛 Dispatch Master →
        </Link>
      </header>

      <main className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Long Term Memory */}
        <section className="bg-slate-800 rounded-xl p-6 shadow-xl border border-slate-700">
          <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
            🏛️ Long-Term Memory
          </h2>
          <div className="prose prose-invert max-w-none text-slate-300">
            {longTermMemory.split('\n').map((line, i) => (
              <p key={i} className="mb-2">{line}</p>
            ))}
          </div>
        </section>

        {/* Recent Daily Logs */}
        <section className="space-y-6">
          <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
            📅 Recent Logs
          </h2>
          {memoryFiles.slice(0, 5).map(file => {
            const content = fs.readFileSync(path.join(WORKSPACE_PATH, 'memory', file), 'utf-8');
            return (
              <div key={file} className="bg-slate-800 rounded-xl p-6 shadow-lg border border-slate-700">
                <h3 className="text-lg font-medium text-blue-400 mb-2">{file}</h3>
                <div className="text-sm text-slate-400 line-clamp-5">
                  {content}
                </div>
              </div>
            );
          })}
        </section>
      </main>
    </div>
  );
}