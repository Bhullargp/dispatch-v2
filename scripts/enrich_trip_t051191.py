import sqlite3
import os

DB_PATH = '/Users/gurneet/.openclaw/workspace/2nd-brain/dispatch.db'

def enrich_trip_t051191():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # 1. Update Trip Details (Notes for trailer swap logic)
    # Start: Feb 05. Trailer 1055R -> 1056R (Swap at Harrow, ON).
    cursor.execute('''
        UPDATE trips 
        SET notes = ?
        WHERE trip_number = ?
    ''', ('Started Thu Feb 05. Trailer Switch in Harrow: 1055R -> 1056R. Stop 1: Harrow (Drop/Hook). Stop 2: Dodge Center, MN. Stop 3: Owatonna, MN.', 'T051191'))
    
    # 2. Add Stops
    cursor.execute("DELETE FROM stops WHERE trip_number = 'T051191'")
    stops = [
        ('T051191', 'PICKUP', 'Caledon, ON', 'Origin', 0),
        ('T051191', 'DROP_HOOK', 'Harrow, ON', 'Trailer Swap (1055R->1056R)', 232),
        ('T051191', 'DELIVER', 'Dodge Center, MN', 'Stop 2', 913),
        ('T051191', 'PICKUP', 'Owatonna, MN', 'Stop 3', 938),
        ('T051191', 'DROP', 'Caledon, ON', 'Final', 1856)
    ]
    cursor.executemany('''
        INSERT INTO stops (trip_number, stop_type, location, description, miles_from_last)
        VALUES (?, ?, ?, ?, ?)
    ''', stops)
    
    # 3. Add Extra Pay (Inferred from PDF events)
    cursor.execute("DELETE FROM extra_pay WHERE trip_number = 'T051191'")
    extras = [
        ('T051191', 'Trailer Switch', 0, 0, 'Switch at Atlas Tube - Harrow', '2026-02-05')
    ]
    cursor.executemany('''
        INSERT INTO extra_pay (trip_number, type, amount, duration_hours, description, date)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', extras)
    
    conn.commit()
    conn.close()
    print("Trip T051191 enriched.")

if __name__ == "__main__":
    enrich_trip_t051191()