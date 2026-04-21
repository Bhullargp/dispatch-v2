import sqlite3
import os

DB_PATH = '/Users/gurneet/.openclaw/workspace/2nd-brain/dispatch.db'

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Trips Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS trips (
            trip_number TEXT PRIMARY KEY,
            start_date TEXT,
            driver_name TEXT,
            truck_number TEXT,
            trailer_number TEXT,
            total_miles REAL,
            start_odometer REAL,
            end_odometer REAL,
            route TEXT,
            status TEXT DEFAULT 'Active',
            notes TEXT
        )
    ''')
    
    # Stops Table (Pickups/Deliveries)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS stops (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_number TEXT,
            stop_type TEXT, -- PICKUP, DELIVER, BORDER, etc.
            location TEXT,
            scheduled_time TEXT,
            miles_from_last REAL,
            description TEXT,
            FOREIGN KEY (trip_number) REFERENCES trips (trip_number)
        )
    ''')
    
    # Extra Pay Table (Tarping, Waiting, Layovers)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS extra_pay (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_number TEXT,
            type TEXT, -- Tarp, Untarp, Waiting, Layover
            amount REAL,
            duration_hours REAL,
            description TEXT,
            date TEXT,
            FOREIGN KEY (trip_number) REFERENCES trips (trip_number)
        )
    ''')
    
    # Fuel Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS fuel (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_number TEXT,
            date TEXT,
            location TEXT,
            quantity REAL,
            unit TEXT, -- Gallons or Liters
            amount_usd REAL,
            FOREIGN KEY (trip_number) REFERENCES trips (trip_number)
        )
    ''')
    
    conn.commit()
    conn.close()
    print(f"Database initialized at {DB_PATH}")

if __name__ == "__main__":
    init_db()
