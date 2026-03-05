import sqlite3
import os

DB_PATH = '/Users/gurneet/.openclaw/workspace/2nd-brain/dispatch.db'

def update_statuses():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Mark old trips as Completed
    cursor.execute("UPDATE trips SET status = 'Completed' WHERE trip_number IN ('T050849', 'T050575')")
    
    # Ensure active trip is Active
    cursor.execute("UPDATE trips SET status = 'Active' WHERE trip_number = 'T051292'")
    
    conn.commit()
    conn.close()
    print("Statuses updated.")

if __name__ == "__main__":
    update_statuses()