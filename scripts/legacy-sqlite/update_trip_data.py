import sqlite3
import os

DB_PATH = '/Users/gurneet/.openclaw/workspace/2nd-brain/dispatch.db'

def update_trip():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # 1. Update the main Trip details
    cursor.execute('''
        UPDATE trips 
        SET start_odometer = ?,
            notes = ?
        WHERE trip_number = ?
    ''', (1528693, 'Ended Jan 16. Extra Delivery: 1', 'T050575'))
    
    # 2. Add the Waiting Time (3h 45m = 3.75 hours)
    cursor.execute('''
        INSERT INTO extra_pay (trip_number, type, amount, duration_hours, description, date)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', ('T050575', 'Waiting', 0, 3.75, '3 hours 45 minutes waiting', '2026-01-14'))
    
    conn.commit()
    conn.close()
    print("Success")

if __name__ == "__main__":
    update_trip()