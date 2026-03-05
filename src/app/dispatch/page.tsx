import React from 'react';
import Link from 'next/link';
import Database from 'better-sqlite3';
import path from 'path';
import TripSheetClient from './TripSheetClient';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');

export default function TripSheetPage() {
  const db = new Database(dbPath);
  
  const trips = db.prepare(`
    SELECT t.*, 
    (SELECT location FROM stops WHERE trip_number = t.trip_number AND location NOT LIKE '%Caledon%' ORDER BY id ASC LIMIT 1) as first_stop,
    (SELECT location FROM stops WHERE trip_number = t.trip_number AND location NOT LIKE '%Caledon%' ORDER BY id DESC LIMIT 1) as last_stop,
    (SELECT json_group_array(json_object('type', type, 'amount', amount, 'quantity', quantity)) FROM extra_pay WHERE trip_number = t.trip_number) as extra_pay_json
    FROM trips t 
    ORDER BY trip_number DESC 
    LIMIT 50
  `).all();

  return <TripSheetClient initialTrips={trips} />;
}
