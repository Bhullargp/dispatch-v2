import sqlite3
import os

db_path = '2nd-brain/dispatch.db'
if not os.path.exists(db_path):
    print("DB not found")
    exit(1)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Check if pdf_path exists
cursor.execute("PRAGMA table_info(trips)")
columns = [col[1] for col in cursor.fetchall()]

if 'pdf_path' not in columns:
    print("Adding pdf_path column...")
    cursor.execute("ALTER TABLE trips ADD COLUMN pdf_path TEXT")
    conn.commit()
    print("Column added.")
else:
    print("pdf_path column already exists.")

conn.close()
