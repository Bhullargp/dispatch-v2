import sqlite3
import os
import re
from PyPDF2 import PdfReader

DB_PATH = '/Users/gurneet/.openclaw/workspace/2nd-brain/dispatch.db'
MEDIA_PATH = '/Users/gurneet/.openclaw/media/inbound'

TRIP_TO_PDF_MAP = {
    'T051292': 'file_20---c6ca32e4-0ac5-41cd-b71d-53c1a428b015.pdf',
    'T051191': 'file_21---48c20ad0-e4b5-4c43-95b9-ef3488db70d4.pdf',
    'T051073': 'file_22---23cef0bd-61e8-4fae-9660-7d04139fbcdd.pdf',
    'T050923': 'file_23---d277d7c3-189a-47e2-8887-849f0d01313c.pdf',
    'T050849': 'file_19---7937ca42-5777-415d-ae9b-fe29470623ac.pdf',
    'T050728': 'file_24---580d2316-a13a-4cf0-8923-43f2a42d5ccf.pdf',
    'T050575': 'file_18---71ad0de3-4ecb-471d-896a-c43b2bd267d9.pdf',
}

def get_stop_date(stop_location: str, raw_pdf_text: str) -> str | None:
    if not raw_pdf_text or not stop_location: return None
    try:
        city_pattern = re.escape(stop_location.split(',')[0].strip())
        # Regex to find the whole block, from "HOOK/DROP/etc" to the next one
        block_regex = re.compile(f"((?:DROP|HOOK|PICKUP|DELIVER)\\s*\\({city_pattern}[^)]*\\))(.+?)(?=(?:PICKUP|DELIVER|DROP|HOOK|RELEASE|ACQUIRE|BORDER|SPECIAL)|$)", re.IGNORECASE | re.DOTALL)
        
        matches = list(block_regex.finditer(raw_pdf_text))
        if not matches: return None

        # Find a date like "MON, FEB 2" or "JAN 18"
        date_regex = re.compile(r"(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\d{1,2})\b", re.IGNORECASE)

        for match in matches:
            date_match = date_regex.search(match.group(0))
            if date_match:
                return date_match.group(1)
        return None
    except Exception as e:
        return None

def rebuild_all_data():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        cursor.execute("ALTER TABLE stops ADD COLUMN date TEXT")
    except sqlite3.OperationalError:
        pass # Column already exists

    trips = cursor.execute("SELECT trip_number, notes FROM trips").fetchall()

    for trip_number, notes in trips:
        pdf_filename = TRIP_TO_PDF_MAP.get(trip_number)
        if not pdf_filename: continue
        
        pdf_path = os.path.join(MEDIA_PATH, pdf_filename)
        if not os.path.exists(pdf_path): continue

        print(f"--- Processing {trip_number} ---")
        
        try:
            reader = PdfReader(pdf_path)
            raw_text = "".join(page.extract_text() for page in reader.pages if page.extract_text())
        except Exception: continue

        clean_notes = (notes or '').split('--- RAW PDF DATA ---')[0].strip()
        new_notes_with_raw_data = f"{clean_notes}\n\n--- RAW PDF DATA ---\n{raw_text}"
        cursor.execute("UPDATE trips SET notes = ? WHERE trip_number = ?", (new_notes_with_raw_data, trip_number))

        trip_stops = cursor.execute("SELECT id, location FROM stops WHERE trip_number = ?", (trip_number,)).fetchall()
        for stop_id, location in trip_stops:
            if not location: continue
            stop_date = get_stop_date(location, raw_text)
            if stop_date:
                cursor.execute("UPDATE stops SET date = ? WHERE id = ?", (stop_date, stop_id))
                print(f"  -> Set date for '{location}': {stop_date}")

    conn.commit()
    conn.close()
    print("\n--- Universal Data Rebuild Complete ---")

if __name__ == "__main__":
    rebuild_all_data()
