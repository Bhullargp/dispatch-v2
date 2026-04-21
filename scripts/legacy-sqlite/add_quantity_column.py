import sqlite3
import os

DB_PATH = '/Users/gurneet/.openclaw/workspace/2nd-brain/dispatch.db' # Corrected Path

def add_quantity_column():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    try:
        cursor.execute("ALTER TABLE extra_pay ADD COLUMN quantity INTEGER DEFAULT 1")
        print("SUCCESS: Added 'quantity' column to extra_pay table.")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print("INFO: 'quantity' column already exists in extra_pay table.")
        else:
            print(f"CRITICAL ERROR during migration: {e}")
            conn.close()
            return

    conn.commit()
    conn.close()

if __name__ == "__main__":
    add_quantity_column()