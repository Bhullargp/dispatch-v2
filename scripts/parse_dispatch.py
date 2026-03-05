import sqlite3
import re
import sys

DB_PATH = '/Users/gurneet/.openclaw/workspace/2nd-brain/dispatch.db'

def parse_itinerary(text):
    # Extract Trip Number
    trip_match = re.search(r"Trip Itinerary (T\d+)", text)
    trip_number = trip_match.group(1) if trip_match else "Unknown"
    
    # Extract Lead Driver
    driver_match = re.search(r"Lead Driver\s+([A-Z ]+)", text)
    driver_name = driver_match.group(1).strip() if driver_match else "Unknown"
    
    # Extract Start Date
    date_match = re.search(r"Start Date:\s+([A-Za-z0-9, ]+)", text)
    start_date = date_match.group(1).strip() if date_match else "Unknown"
    
    # Extract Total Miles
    miles_match = re.search(r"TOTAL ROUTED MILES:\s+([\d,]+)", text)
    total_miles = float(miles_match.group(1).replace(',', '')) if miles_match else 0.0
    
    # Extract Truck & Trailer
    truck_match = re.search(r"Truck:\s+(\d+)", text)
    truck_num = truck_match.group(1) if truck_match else "Unknown"
    
    trailer_match = re.search(r"Trailer:\s+(\d+[A-Z]?)", text)
    trailer_num = trailer_match.group(1) if trailer_match else "Unknown"

    return {
        "trip_number": trip_number,
        "start_date": start_date,
        "driver_name": driver_name,
        "truck_number": truck_num,
        "trailer_number": trailer_num,
        "total_miles": total_miles
    }

def save_trip(data):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    try:
        cursor.execute('''
            INSERT OR REPLACE INTO trips (trip_number, start_date, driver_name, truck_number, trailer_number, total_miles)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (data['trip_number'], data['start_date'], data['driver_name'], data['truck_number'], data['trailer_number'], data['total_miles']))
        conn.commit()
        print(f"Trip {data['trip_number']} saved successfully.")
    except Exception as e:
        print(f"Error saving trip: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    raw_text = sys.stdin.read()
    trip_data = parse_itinerary(raw_text)
    print(f"Extracted Data: {trip_data}")
    save_trip(trip_data)
