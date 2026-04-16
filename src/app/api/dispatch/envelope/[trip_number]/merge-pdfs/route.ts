import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { getServerAccess } from '@/lib/ownership';
import { getTripReceiptDocuments } from '@/lib/dispatch-documents';
import { downloadFromR2 } from '@/lib/r2-storage';

const execFileAsync = promisify(execFile);

function matchFuelEntryForDocument(doc: any, fuelEntries: any[]) {
  const haystack = `${doc.original_filename || ''} ${doc.description || ''} ${doc.source_path || ''}`.toLowerCase();
  const dateMatch = haystack.match(/(20\d{2}-\d{2}-\d{2})/);
  const dated = dateMatch ? fuelEntries.filter((f: any) => String(f.date || '') === dateMatch[1]) : fuelEntries;
  const candidates = dated.length ? dated : fuelEntries;
  const byLocation = candidates.find((f: any) => {
    const city = String(f.location || '').split(',')[0].trim().toLowerCase();
    return city && haystack.includes(city);
  });
  return byLocation || candidates[0] || null;
}

async function materializeReceiptFile(_request: Request, doc: any, idx: number, userId: number | string) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dispatch-merge-'));
  let ext = '.bin';
  const filename = String(doc.original_filename || doc.filename || `receipt-${idx}`);
  const match = filename.match(/(\.[a-zA-Z0-9]+)$/);
  if (match) ext = match[1].toLowerCase();
  const outPath = path.join(tmpDir, `${idx}${ext}`);

  if (doc.source_path) {
    await fs.copyFile(doc.source_path, outPath);
    return { outPath, tmpDir };
  }

  if (doc.file_key) {
    const buf = await downloadFromR2(doc.file_key);
    await fs.writeFile(outPath, buf);
    return { outPath, tmpDir };
  }

  throw new Error(`Receipt ${filename} has no accessible path`);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ trip_number: string }> }
) {
  const tempDirs: string[] = [];
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const access = await getServerAccess();
    if (!access) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { trip_number } = await params;
    const trip = await db().get(
      `SELECT trip_number FROM trips WHERE trip_number = $1 AND (${access.adminMode ? '1=1' : 'user_id = $2'})`,
      access.adminMode ? [trip_number] : [trip_number, access.session.userId]
    ) as { trip_number: string } | undefined;

    if (!trip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const receiptDocuments = await getTripReceiptDocuments(access.session.userId, trip_number);
    if (!receiptDocuments.length) return NextResponse.json({ error: 'No fuel receipts linked to this trip yet' }, { status: 404 });

    const fuelEntries = await db().query(
      `SELECT id, date, location, odometer FROM fuel WHERE trip_number = $1 AND (${access.adminMode ? '1=1' : 'user_id = $2'}) ORDER BY date ASC, id ASC`,
      access.adminMode ? [trip_number] : [trip_number, access.session.userId]
    );

    const files: string[] = [];
    for (let i = 0; i < receiptDocuments.length; i++) {
      const { outPath, tmpDir } = await materializeReceiptFile(request, receiptDocuments[i], i + 1, access.session.userId);
      tempDirs.push(tmpDir);
      files.push(outPath);
    }

    const receiptMeta = receiptDocuments.map((doc: any, i: number) => {
      const fuel = matchFuelEntryForDocument(doc, fuelEntries as any[]);
      return {
        file: files[i],
        filename: doc.original_filename || doc.filename || `receipt-${i + 1}`,
        date: fuel?.date || null,
        location: fuel?.location || null,
        odometer: fuel?.odometer != null ? String(Number(fuel.odometer).toLocaleString('en-US')) : null,
      };
    });

    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dispatch-merged-out-'));
    tempDirs.push(outDir);
    const outPdf = path.join(outDir, `${trip_number}-fuel-receipts.pdf`);
    const metaJson = path.join(outDir, 'receipt-meta.json');
    await fs.writeFile(metaJson, JSON.stringify(receiptMeta, null, 2));

    const py = `
import sys, json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from PyPDF2 import PdfReader, PdfWriter
from reportlab.pdfgen import canvas

out_pdf = Path(sys.argv[1])
meta = json.loads(Path(sys.argv[2]).read_text())
writer = PdfWriter()

def make_overlay(tmp_path, odo_text, page_w, page_h):
    c = canvas.Canvas(str(tmp_path), pagesize=(float(page_w), float(page_h)))
    c.setFont('Helvetica-Bold', 16)
    c.setFillColorRGB(0.8, 0.0, 0.0)
    c.drawString(36, float(page_h) - 28, odo_text)
    c.save()

for item in meta:
    p = Path(item['file'])
    suffix = p.suffix.lower()
    odo_text = f"ODO={item.get('odometer') or ''}" if item.get('odometer') else ''
    if suffix == '.pdf':
        reader = PdfReader(str(p))
        for idx, page in enumerate(reader.pages):
            if idx == 0 and odo_text:
                overlay_pdf = p.with_suffix('.overlay.pdf')
                make_overlay(overlay_pdf, odo_text, float(page.mediabox.width), float(page.mediabox.height))
                overlay_reader = PdfReader(str(overlay_pdf))
                page.merge_page(overlay_reader.pages[0])
                overlay_pdf.unlink(missing_ok=True)
            writer.add_page(page)
    else:
        img = Image.open(p)
        if getattr(img, 'mode', None) in ('RGBA', 'P'):
            img = img.convert('RGB')
        if odo_text:
            draw = ImageDraw.Draw(img)
            try:
                font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 36)
            except Exception:
                font = ImageFont.load_default()
            draw.rectangle((18, 18, 360, 74), fill='white')
            draw.text((28, 28), odo_text, fill='red', font=font)
        tmp_pdf = p.with_suffix('.tmp.pdf')
        img.save(tmp_pdf, 'PDF', resolution=100.0)
        reader = PdfReader(str(tmp_pdf))
        for page in reader.pages:
            writer.add_page(page)
        tmp_pdf.unlink(missing_ok=True)
with open(out_pdf, 'wb') as f:
    writer.write(f)
print(out_pdf)
`;

    await execFileAsync('python3', ['-c', py, outPdf, metaJson], { timeout: 120000, maxBuffer: 20 * 1024 * 1024 });
    const merged = await fs.readFile(outPdf);

    return new NextResponse(merged, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${trip_number}-fuel-receipts.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    for (const d of tempDirs) {
      try { await fs.rm(d, { recursive: true, force: true }); } catch {}
    }
  }
}
