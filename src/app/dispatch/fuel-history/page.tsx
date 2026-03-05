import React from 'react';
import Database from 'better-sqlite3';
import path from 'path';
import FuelHistoryClient from './FuelHistoryClient';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');

export default function FuelHistoryPage() {
  const db = new Database(dbPath);
  
  // Get all fuel entries
  const fuelEntries = db.prepare(`
    SELECT * FROM fuel 
    ORDER BY date DESC 
    LIMIT 200
  `).all();

  // Get active/recent trips for the dropdown
  const trips = db.prepare(`
    SELECT trip_number, status, start_date 
    FROM trips 
    WHERE status != 'Cancelled'
    ORDER BY start_date DESC 
    LIMIT 30
  `).all();

  return <FuelHistoryClient initialFuel={fuelEntries} trips={trips} />;
}
