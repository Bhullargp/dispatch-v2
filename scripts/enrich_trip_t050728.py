import sqlite3
import os
import re
from PyPDF2 import PdfReader

DB_PATH = '/Users/gurneet/.openclaw/workspace/2nd-brain/dispatch.db'

def enrich_trip_t050728():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Full raw text for date extraction
    pdf_path = '/Users/gurneet/.openclaw/workspace/2nd-brain/public/pdfs/T050728.pdf'
    raw_text = ""
    try:
        reader = PdfReader(pdf_path)
        raw_text = "".join(page.extract_text() for page in reader.pages if page.extract_text())
    except Exception as e:
        print(f"Could not read PDF for T050728 to extract dates: {e}")
    
    # 1. Update Trip Details
    cursor.execute('''
        UPDATE trips 
        SET notes = ?,
            status = 'Completed'
        WHERE trip_number = ?
    ''', (f"Started Jan 19. Trailer Switch: 1050R -> 5317F. Extras: 1 untarp, 2 tarp, 2 extra pickup.\n\n--- RAW PDF DATA ---\n{raw_text}", 'T050728'))
    
    # 2. Add Stops
    cursor.execute("DELETE FROM stops WHERE trip_number = 'T050728'")
    stops = [
        ('T050728', 'PICKUP', 'Caledon, ON', 'Origin', 0, None),
        ('T050728', 'DROP_HOOK', 'Harrow, ON', 'Trailer Swap', 232, 'Jan 18'), # From PDF
        ('T050728', 'DELIVER', 'Dodge Center, MN', 'Stop 2', 913, 'Jan 20'),
        ('T050728', 'PICKUP', 'Green Bay, WI', 'Stop 3', 1209, 'Jan 20'),
        ('T050728', 'DROP', 'Caledon, ON', 'Final', 1957, None)
    ]
    cursor.executemany('''
        INSERT INTO stops (trip_number, stop_type, location, description, miles_from_last, date)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', stops)
    
    # 3. Add Extra Pay
    cursor.execute("DELETE FROM extra_pay WHERE trip_number = 'T050728'")
    extras = [
        ('T050728', 'Trailer Switch', 1, 0, 'Switch in Harrow', '2026-01-18'),
        ('T050728', 'Untarping', 1, 0, 'From Special Instructions', None),
        ('T050728', 'Tarping', 2, 0, 'From Special Instructions', None),
        ('T050728', 'Extra Pickup', 2, 0, 'From Special Instructions', None)
    ]
    cursor.executemany('''
        INSERT INTO extra_pay (trip_number, type, quantity, duration_hours, description, date)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', extras)
    
    conn.commit()
    conn.close()
    print("Trip T050728 enriched with extras and stops.")

if __name__ == "__main__":
    enrich_trip_t050728()