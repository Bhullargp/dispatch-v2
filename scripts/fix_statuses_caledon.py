import sqlite3
import os

DB_PATH = '/Users/gurneet/.openclaw/workspace/2nd-brain/dispatch.db'

def fix_statuses():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Logic:
    # 1. T051292 -> Active (It ends in Brownsville, NOT Caledon) -> Actually user said "incomplete dispatch" for these, but "active" if current?
    #    User said: "if trip ends at a customer (not Caledon), mark as In Progress or Awaiting Return Dispatch"
    #    Since T051292 is the *current* one (Feb 9 start), it is Active.
    
    # 2. T051191 (Feb 5) -> Completed (Ends in Caledon)
    # 3. T051073 (Jan 30) -> Completed (Ends in Caledon)
    # 4. T050849 (Jan 22) -> Completed (Ends in Caledon)
    # 5. T050575 (Jan 14) -> Completed (Ends in Caledon)

    cursor.execute("UPDATE trips SET status = 'Completed' WHERE trip_number IN ('T051191', 'T051073', 'T050849', 'T050575')")
    cursor.execute("UPDATE trips SET status = 'Active' WHERE trip_number = 'T051292'")
    
    conn.commit()
    conn.close()
    print("Trip statuses corrected based on Caledon return rule.")

if __name__ == "__main__":
    fix_statuses()