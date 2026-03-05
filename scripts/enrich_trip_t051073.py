import sqlite3
import os

DB_PATH = '/Users/gurneet/.openclaw/workspace/2nd-brain/dispatch.db'

def enrich_trip_t051073():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # 1. Update Trip Details
    cursor.execute('''
        UPDATE trips 
        SET notes = ?
        WHERE trip_number = ?
    ''', ('Started Jan 30. Trailer Switch in Harrow: 1033R -> 1017R. Stop 1: Harrow (Drop/Hook). Stop 2: Dodge Center, MN. Stop 3: Green Bay, WI. 1 Layover detected in Special Instructions.', 'T051073'))
    
    # 2. Add Stops
    cursor.execute("DELETE FROM stops WHERE trip_number = 'T051073'")
    stops = [
        ('T051073', 'PICKUP', 'Caledon, ON', 'Origin', 0),
        ('T051073', 'DROP_HOOK', 'Harrow, ON', 'Trailer Swap (1033R->1017R)', 232),
        ('T051073', 'DELIVER', 'Dodge Center, MN', 'Stop 2', 913),
        ('T051073', 'PICKUP', 'Green Bay, WI', 'Stop 3', 1209),
        ('T051073', 'DROP', 'Caledon, ON', 'Final', 1957)
    ]
    cursor.executemany('''
        INSERT INTO stops (trip_number, stop_type, location, description, miles_from_last)
        VALUES (?, ?, ?, ?, ?)
    ''', stops)
    
    # 3. Add Extra Pay (Detected: Layover & Trailer Switch)
    cursor.execute("DELETE FROM extra_pay WHERE trip_number = 'T051073'")
    extras = [
        ('T051073', 'Trailer Switch', 0, 0, 'Switch at Atlas Tube - Harrow', '2026-01-30'),
        ('T051073', 'Layover', 0, 0, '1 Layover - Gurkirat (from PDF)', '2026-02-02')
    ]
    cursor.executemany('''
        INSERT INTO extra_pay (trip_number, type, amount, duration_hours, description, date)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', extras)
    
    conn.commit()
    conn.close()
    print("Trip T051073 enriched with Layover.")

if __name__ == "__main__":
    enrich_trip_t051073()