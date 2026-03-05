import sqlite3
import os

DB_PATH = '/Users/gurneet/.openclaw/workspace/2nd-brain/dispatch.db'

def enrich_trip_t050923():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # 1. Update Trip Details
    # Start: Jan 25. Ends in Caledon (Complete).
    cursor.execute('''
        UPDATE trips 
        SET notes = ?,
            status = 'Completed'
        WHERE trip_number = ?
    ''', ('Started Sun Jan 25. Route: Caledon -> Montgomery, AL -> Summerdale, AL -> Prevost, QC -> Caledon. 3,208 total miles.', 'T050923'))
    
    # 2. Add Stops
    cursor.execute("DELETE FROM stops WHERE trip_number = 'T050923'")
    stops = [
        ('T050923', 'PICKUP', 'Caledon, ON', 'Origin', 0),
        ('T050923', 'DELIVER', 'Montgomery, AL', 'Stop 1', 1073),
        ('T050923', 'PICKUP', 'Summerdale, AL', 'Stop 2', 1247),
        ('T050923', 'DELIVER', 'Prevost, QC', 'Stop 3', 2827),
        ('T050923', 'DROP', 'Caledon, ON', 'Final', 3208)
    ]
    cursor.executemany('''
        INSERT INTO stops (trip_number, stop_type, location, description, miles_from_last)
        VALUES (?, ?, ?, ?, ?)
    ''', stops)
    
    conn.commit()
    conn.close()
    print("Trip T050923 enriched.")

if __name__ == "__main__":
    enrich_trip_t050923()