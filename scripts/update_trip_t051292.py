import sqlite3
import os

DB_PATH = '/Users/gurneet/.openclaw/workspace/2nd-brain/dispatch.db'

def update_trip_t051292():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # 1. Update Trip Details
    cursor.execute('''
        UPDATE trips 
        SET start_odometer = ?,
            notes = ?
        WHERE trip_number = ?
    ''', (1547674, 'Started Mon Feb 09. Ended Sat Feb 14. Trailer Switch + Gear Move in Laredo.', 'T051292'))
    
    # 2. Add Extra Pay: Trailer Switch
    cursor.execute('''
        INSERT INTO extra_pay (trip_number, type, amount, duration_hours, description, date)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', ('T051292', 'Trailer Switch', 0, 0, 'Switch in Laredo Yard', '2026-02-11'))

    # 3. Add Extra Pay: Moving Chains/Binders
    cursor.execute('''
        INSERT INTO extra_pay (trip_number, type, amount, duration_hours, description, date)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', ('T051292', 'Gear Move', 0, 0, 'Moved chains/binders to new trailer', '2026-02-11'))
    
    conn.commit()
    conn.close()
    print("Success")

if __name__ == "__main__":
    update_trip_t051292()