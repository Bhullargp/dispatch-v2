import sqlite3
import os

DB_PATH = '/Users/gurneet/.openclaw/workspace/2nd-brain/dispatch.db'

def fix_caledon_dates():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # 1. Update trip start_date from the first stop (Origin) if it's Caledon
    cursor.execute("""
        UPDATE trips 
        SET start_date = (
            SELECT date FROM stops 
            WHERE stops.trip_number = trips.trip_number 
            AND (location LIKE '%Caledon%' OR stop_type = 'ORIGIN')
            AND date IS NOT NULL AND date != ''
            ORDER BY id ASC LIMIT 1
        )
        WHERE EXISTS (
            SELECT 1 FROM stops 
            WHERE stops.trip_number = trips.trip_number 
            AND (location LIKE '%Caledon%' OR stop_type = 'ORIGIN')
            AND date IS NOT NULL AND date != ''
        )
    """)
    
    # 2. Update trip end_date from the last stop (Drop/Final) if it's Caledon
    cursor.execute("""
        UPDATE trips 
        SET end_date = (
            SELECT date FROM stops 
            WHERE stops.trip_number = trips.trip_number 
            AND (location LIKE '%Caledon%' OR stop_type IN ('DROP', 'FINAL'))
            AND date IS NOT NULL AND date != ''
            ORDER BY id DESC LIMIT 1
        )
        WHERE EXISTS (
            SELECT 1 FROM stops 
            WHERE stops.trip_number = trips.trip_number 
            AND (location LIKE '%Caledon%' OR stop_type IN ('DROP', 'FINAL'))
            AND date IS NOT NULL AND date != ''
        )
    """)
    
    print(f"Updated {conn.total_changes} rows in trips table.")
    conn.commit()
    conn.close()

if __name__ == "__main__":
    fix_caledon_dates()
