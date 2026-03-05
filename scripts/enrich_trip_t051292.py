import sqlite3
import os

DB_PATH = '/Users/gurneet/.openclaw/workspace/2nd-brain/dispatch.db'

def add_full_details_t051292():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # 1. Update Trip Details
    # Adding End Odometer: 1,554,314
    # Updating Notes to store RAW PDF TEXT for reference (as requested)
    raw_pdf_snippet = """
Start Date: Mon Feb 09, 2026 Name: Vikramjeet Singh Gill EMail: flatbedteam@dmtransport.ca Issued On: Feb 11, 2026 at 11:27AM Lead Driver GURNEETPAL SINGH BHULLAR Team Driver Dispatched By ROUTING INSTRUCTIONS TOTAL ROUTED MILES: 2,185 ACQUIRE (CALEDON, ON) DM TRANSPORT - YARD 121 HEALEY ROAD CALEDON, ON Truck: 598 HOOK (CALEDON, ON) DM TRANSPORT - YARD 121 HEALEY ROAD CALEDON, ON Trailer: 5322F Freight Specifics BOL No.\Reference No. # P/U Ref. Cargo Description Probill P070207 1 1 truck load, 46000 lbs FTL STEEL BARS BARS // NEEDS ROLLTITE OR FLATBED #: 1603419 TARPS + POLYTHENE WRAP BLANKETS TO PROTECT PRODUCT CARRIER BONDED LOAD Consignee: JOWAR INTERNATIONAL - EAGLE PASS, TX Pickup Notes: :TRUCKERS – MANDATORY AT ALL TIMES PERSONAL PROTECTIVE EQUIPMENT (PPE): SAFETY HELMET AND GLASSES LONG SLEEVES FLUORESCENT JACKET GLOVES LONG PANTS SAFETY BOOTS SITE ROAD SAFETY RULES: CELL PHONE IS PERMITTED ONLY WHEN USED WITH A HANDS-FREE SYSTEM WHILE DRIVING SEATBELT USE IS MANDATORY PRIORITY TO LOCOMOTIVES NO PETS ALLOWED TRUCKERS: NO PASSENGERS ALLOWED FOLLOW THE HIGHWAY SAFETY CODE PARKING BACKWARDS (PERSONAL VEHICLE) ADDITIONAL REQUIREMENTS: LOAD MUST BE TARPED DRIVERS MUST HAVE ALL SAFETY GEAR IN TRUCK AT ALL TIMES MUST ALSO HAVE A MINIMUM OF 6 PIECES OF 4X4 WOOD FAILURE TO ARRIVE WITH EQUIPMENT WILL RESULT IN FINES IF CARRIER IS A BONDED CARRIER, THEY MUST ALWAYS CREATE AND USE THEIR OWN BOND DRIVER TRACKING IS MANDATORY AT ALL TIMES DRIVER CHECK-IN: DRIVER MUST CHECK IN UNDER FLS BY APPOINTMENT ONLY MONDAY TO SUNDAY 7:00 AM – 11:00 PM BORDER CROSSING (PORT HURON, MI) 185 miles from last stop (185.00 miles traveled, 2,000.00 miles remaining) DELIVER (EAGLE PASS, TX) SCHEDULED FOR - WED, FEB 11 BETWEEN 8:00 AM AND 5:00 PM 1,665 miles from last stop (1,850.00 miles traveled, 335.00 miles remaining) JOWAR INTERNATIONAL 1049 ADAMS CIRCLE EAGLE PASS, TX, 78852 Tel: (830) 758-0040 Trailer: 5322F Freight Specifics BOL No.\Reference No. # Del Ref. Cargo Description Probill P070207 1 1 truck load, 46000 lbs FTL STEEL BARS BARS // NEEDS ROLLTITE OR FLATBED #: 1603419 TARPS + POLYTHENE WRAP BLANKETS TO PROTECT PRODUCT CARRIER BONDED LOAD DROP (LAREDO, TX) 121 miles from last stop (1,971.00 miles traveled, 214.00 miles remaining) MONE TRANSPORT - LAREDO YARD 14002 MINES ROAD LAREDO, TX, 78045 Trailer: 5322F Trip Itinerary T051292 (Continued) Page 2 of 2 HOOK (LAREDO, TX) MONE TRANSPORT - LAREDO YARD 14002 MINES ROAD LAREDO, TX, 78045 Trailer: 1025R PICKUP (BROWNSVILLE, TX) APPOINTMENT - WED, FEB 11 AT 1:00 PM 214 miles from last stop (2,185.00 miles traveled, 0.00 miles remaining) RARE IMPORT 1705 BILLY MITCHELL AVE BROWNSVILLE, TX, 78521 Tel: (956) 504-3133 Trailer: 1025R Freight Specifics BOL No.\Reference No. # P/U Ref. Cargo Description Probill P070395 1 20 pallets, 44709 lbs Low Carbon Ferro Chrome non Haz #: HG25167-1 #'DKE-K5C' Consignee: MULTITECH - JONQUIERE, QC Pickup Notes: BELOW IS A LIST OF THE SHIPMENT REQUIREMENTS PER LOAD BASIS PROVIDED BY OUR CUSTOMER TO KING OF FREIGHT. KING OF FREIGHT IS A THIRD PARTY FREIGHT BROKERAGE BETWEEN OUR CUSTOMER AND THE CARRIER FOR THIS SHIPMENT. FAILURE TO MEET THESE REQUIREMENTS COULD RESULT IN A PENALTY. DRIVER MUST ADHERE TO SHIPPER AND RECIEVER EQUIPMENT OF HELMET, SAFETY BOOTS, PROTECTIVE EYEGLASSES, LONG SLEEVE SHIRT, AND PANTS. IF HE WEARS A TURBAN, PLEASE HAVE HIM WEAR THE PATKA UNDERNEATH THE HELMET INSTEAD. BONDED CARRIER REQUIRED MOST IMPORTANTLY, PLEASE HAVE THE DRIVER ACQUIRE THE SIGNATURE AND EMPLOYEE NUMBER OF WHOEVER WILL OFFLOAD HIM, AND KEEP A COPY AS A POD. SPECIAL INSTRUCTIONS
"""
    
    cursor.execute('''
        UPDATE trips 
        SET end_odometer = ?,
            notes = ?
        WHERE trip_number = ?
    ''', (1554314, f"Started Mon Feb 09. Ended Sat Feb 14. Trailer Switch: 5322F -> 1025R (Laredo). Gear Move. Stop 1: Eagle Pass. Stop 2: Laredo. Stop 3: Brownsville.\n\n--- RAW PDF DATA ---\n{raw_pdf_snippet}", 'T051292'))
    
    # 2. Add Stops to 'stops' table for better tracking
    # Clear existing stops first to avoid dupes during dev
    cursor.execute("DELETE FROM stops WHERE trip_number = 'T051292'")
    
    stops = [
        ('T051292', 'PICKUP', 'Caledon, ON', 'Origin', 0),
        ('T051292', 'DELIVER', 'Eagle Pass, TX', 'Stop 1', 1850),
        ('T051292', 'DROP_HOOK', 'Laredo, TX', 'Stop 2 (Trailer Swap)', 1971),
        ('T051292', 'PICKUP', 'Brownsville, TX', 'Stop 3 (Final)', 2185)
    ]
    
    cursor.executemany('''
        INSERT INTO stops (trip_number, stop_type, location, description, miles_from_last)
        VALUES (?, ?, ?, ?, ?)
    ''', stops)
    
    conn.commit()
    conn.close()
    print("Trip T051292 fully updated with stops and raw data.")

if __name__ == "__main__":
    add_full_details_t051292()