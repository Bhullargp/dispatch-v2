import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import Database from 'better-sqlite3';
import path from 'path';

// --- Placeholder for PDF extraction logic ---
async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  // In a real scenario, you would use a library like pdf-parse
  // For this example, we'll just return a placeholder.
  console.log("PDF extraction would happen here.");
  return "--- Extracted PDF Content ---";
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const tripNumber = formData.get('tripNumber') as string;

    if (!file || !tripNumber) {
      return NextResponse.json({ error: 'Missing file or tripNumber' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const uploadDir = join(process.cwd(), 'public', 'itineraries');
    await mkdir(uploadDir, { recursive: true });

    const filename = `${tripNumber}_${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
    const filePath = join(uploadDir, filename);
    await writeFile(filePath, buffer);

    const relativePath = `/itineraries/${filename}`;

    // --- PDF Extraction and DB Update ---
    const rawPdfData = await extractTextFromPdf(buffer);

    const dbPath = path.resolve(process.cwd(), 'dispatch.db');
    const db = new Database(dbPath);

    // Check if there are existing user notes
    const trip = db.prepare('SELECT notes FROM trips WHERE trip_number = ?').get(tripNumber) as { notes: string | null };

    // Update pdf_path and raw_data. Preserve existing notes.
    db.prepare(
      'UPDATE trips SET pdf_path = ?, raw_data = ? WHERE trip_number = ?'
    ).run(relativePath, rawPdfData, tripNumber);

    return NextResponse.json({ success: true, path: relativePath });
  } catch (error: any) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
