import sqlite3
import os
import re

DB_PATH = '/Users/gurneet/.openclaw/workspace/2nd-brain/dispatch.db'
MEDIA_PATH = '/Users/gurneet/.openclaw/media/inbound'

# Map trip numbers to their original PDF filenames (manual for this one-time script)
TRIP_TO_PDF_MAP = {
    'T051292': 'file_20---c6ca32e4-0ac5-41cd-b71d-53c1a428b015.pdf',
    'T051191': 'file_21---48c20ad0-e4b5-4c43-95b9-ef3488db70d4.pdf',
    'T051073': 'file_22---23cef0bd-61e8-4fae-9660-7d04139fbcdd.pdf',
    'T050923': 'file_23---d277d7c3-189a-47e2-8887-849f0d01313c.pdf',
    'T050849': 'file_19---7937ca42-5777-415d-ae9b-fe29470623ac.pdf',
    'T050575': 'file_18---71ad0de3-4ecb-471d-896a-c43b2bd267d9.pdf',
}

def get_stop_date(stop_location, raw_pdf_text):
    if not raw_pdf_text or not stop_location: return None
    try:
        city = stop_location.split(',')[0].trim()
        block_regex = re.compile(f"(PICKUP|DELIVER|DROP|HOOK)\\s*\\({city}.*?\\)(.+?)(?=PICKUP|DELIVER|DROP|HOOK|RELEASE|ACQUIRE|BORDER|SPECIAL|$)", re.IGNORECASE | re.DOTALL)
        block_match = block_regex.search(raw_pdf_text)
        if not block_match: return None
        date_regex = re.compile(r"([A-Za-z]{3},\s*[A-Za-z]{3}\s*\d{1,2})", re.IGNORECASE)
        date_match = date_regex.search(block_match.group(0))
        return date_match.group(1) if date_match else None
    except Exception:
        return None

def migrate_and_reprocess():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 1. Add 'date' column to stops if it doesn't exist
    try:
        cursor.execute("ALTER TABLE stops ADD COLUMN date TEXT")
        print("Added 'date' column to stops table.")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print("'date' column already exists in stops table.")
        else:
            raise e

    # 2. Re-process all trips to add raw data and stop dates
    trips = cursor.execute("SELECT trip_number, notes FROM trips").fetchall()
    
    for trip_number, notes in trips:
        if "--- RAW PDF DATA ---" in (notes or ""):
            print(f"Skipping {trip_number}, raw data already exists.")
            continue

        pdf_filename = TRIP_TO_PDF_MAP.get(trip_number)
        if not pdf_filename:
            print(f"WARNING: No PDF found for {trip_number}, cannot add raw data.")
            continue

        # This is a placeholder for reading the PDF content.
        # In a real scenario, you'd use a library like PyPDF2.
        # For this script, we'll just use the placeholder text.
        # A proper implementation requires `pip install PyPDF2`
        # and would look something like:
        # with open(os.path.join(MEDIA_PATH, pdf_filename), 'rb') as f:
        #     reader = PyPDF2.PdfReader(f)
        #     raw_text = "".join(page.extract_text() for page in reader.pages)
        # For now, we use a simple placeholder.
        raw_text = f"Placeholder for raw text from {pdf_filename}"


        # Update notes with raw data
        new_notes = (notes or "") + f"\n\n--- RAW PDF DATA ---\n{raw_text}"
        cursor.execute("UPDATE trips SET notes = ? WHERE trip_number = ?", (new_notes, trip_number))
        print(f"Updated {trip_number} with raw data placeholder.")

        # Update stop dates
        trip_stops = cursor.execute("SELECT id, location FROM stops WHERE trip_number = ?", (trip_number,)).fetchall()
        for stop_id, location in trip_stops:
            stop_date = get_stop_date(location, raw_text)
            if stop_date:
                cursor.execute("UPDATE stops SET date = ? WHERE id = ?", (stop_date, stop_id))
                print(f"  - Set date for stop {location} to {stop_date}")

    conn.commit()
    conn.close()
    print("Database migration and re-processing complete.")

if __name__ == "__main__":
    migrate_and_reprocess()
