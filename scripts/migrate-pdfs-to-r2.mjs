/**
 * One-time migration: upload all local PDFs to R2, update DB pdf_path
 * Run: node scripts/migrate-pdfs-to-r2.mjs
 */
import { readFile, readdir } from 'fs/promises';
import { join, basename } from 'path';
import pg from 'pg';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createRequire } from 'module';
import { readFileSync } from 'fs';

// Load .env.local manually
const envPath = new URL('../.env.local', import.meta.url).pathname;
const envLines = readFileSync(envPath, 'utf8').split('\n');
for (const line of envLines) {
  const [key, ...rest] = line.split('=');
  if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
}

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const BUCKET     = process.env.R2_BUCKET_NAME || 'dispatch-pdfs';
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;

if (!ACCOUNT_ID || !ACCESS_KEY || !SECRET_KEY) {
  console.error('Missing R2 env vars');
  process.exit(1);
}

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
});

const pool = new pg.Pool({
  host: '127.0.0.1', port: 5432,
  user: 'dispatch_user', password: 'karandeep@',
  database: 'masterdb',
  options: '-c search_path=dispatch',
});

async function uploadToR2(key, buffer) {
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: buffer, ContentType: 'application/pdf',
  }));
}

const ROOT = new URL('..', import.meta.url).pathname;

async function migratePdfsDir() {
  // public/pdfs/T050575.pdf → look up trip in DB to get user_id
  const dir = join(ROOT, 'public', 'pdfs');
  let files;
  try { files = await readdir(dir); } catch { console.log('No public/pdfs dir, skipping'); return; }

  for (const filename of files) {
    if (!filename.endsWith('.pdf')) continue;
    const tripNumber = basename(filename, '.pdf'); // e.g. T050575

    // Look up user_id for this trip
    const row = await pool.query(
      'SELECT user_id, pdf_path FROM trips WHERE trip_number = $1',
      [tripNumber]
    );
    if (!row.rows[0]) { console.log(`  No DB record for ${tripNumber}, skipping`); continue; }

    const { user_id, pdf_path } = row.rows[0];

    // Skip if already on R2
    if (pdf_path && pdf_path.startsWith('r2:')) {
      console.log(`  ${tripNumber} already on R2, skipping`);
      continue;
    }

    const localPath = join(dir, filename);
    const buffer = await readFile(localPath);
    const r2Key = `documents/${user_id}/pdfs/${filename}`;

    try {
      await uploadToR2(r2Key, buffer);
      await pool.query(
        'UPDATE trips SET pdf_path = $1 WHERE trip_number = $2',
        [`r2:${r2Key}`, tripNumber]
      );
      console.log(`  ✓ ${tripNumber} → r2:${r2Key}`);
    } catch (err) {
      console.error(`  ✗ ${tripNumber}: ${err.message}`);
    }
  }
}

async function migrateItinerariesDir() {
  // public/itineraries/file_14---{uuid}.pdf → userId is in the filename prefix
  const dir = join(ROOT, 'public', 'itineraries');
  let files;
  try { files = await readdir(dir); } catch { console.log('No public/itineraries dir, skipping'); return; }

  for (const filename of files) {
    if (!filename.endsWith('.pdf')) continue;

    // Extract userId from filename: file_14---xxx → 14
    const userIdMatch = filename.match(/^file_(\d+)---/);
    const userId = userIdMatch ? userIdMatch[1] : '0';
    const localRelPath = `/itineraries/${filename}`;

    // Check if this path is stored in upload_jobs or trips
    let jobRow = { rows: [] };
    try {
      jobRow = await pool.query(
        'SELECT id, stored_path FROM upload_jobs WHERE stored_path = $1',
        [localRelPath]
      );
    } catch { /* table may not exist yet */ }

    const tripRow = await pool.query(
      'SELECT trip_number, pdf_path FROM trips WHERE pdf_path = $1',
      [localRelPath]
    );

    // Skip if already on R2
    const alreadyR2 = jobRow.rows[0]?.stored_path?.startsWith('r2:') ||
                      tripRow.rows[0]?.pdf_path?.startsWith('r2:');
    if (alreadyR2) { console.log(`  ${filename} already on R2, skipping`); continue; }

    const localPath = join(dir, filename);
    const buffer = await readFile(localPath);
    const r2Key = `documents/${userId}/itineraries/${filename}`;

    try {
      await uploadToR2(r2Key, buffer);

      if (jobRow.rows[0]) {
        try {
          await pool.query(
            'UPDATE upload_jobs SET stored_path = $1 WHERE stored_path = $2',
            [`r2:${r2Key}`, localRelPath]
          );
        } catch { /* table may not exist yet */ }
      }
      if (tripRow.rows[0]) {
        await pool.query(
          'UPDATE trips SET pdf_path = $1 WHERE pdf_path = $2',
          [`r2:${r2Key}`, localRelPath]
        );
      }
      console.log(`  ✓ ${filename} → r2:${r2Key}`);
    } catch (err) {
      console.error(`  ✗ ${filename}: ${err.message}`);
    }
  }
}

console.log('\n── Migrating public/pdfs/ ──');
await migratePdfsDir();

console.log('\n── Migrating public/itineraries/ ──');
await migrateItinerariesDir();

console.log('\n✓ Migration complete');
await pool.end();
