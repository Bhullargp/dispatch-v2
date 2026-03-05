import React from 'react';
import Database from 'better-sqlite3';
import path from 'path';
import TripDetailsClient from '../TripDetailsClient';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');

export default async function TripDetailPage({ params }: { params: Promise<{ trip_number: string }> }) {
  const resolvedParams = await params;
  const trip_number = resolvedParams.trip_number;
  const db = new Database(dbPath);

  const trip = db.prepare('SELECT * FROM trips WHERE trip_number = ?').get(trip_number) as any;
  const stops = db.prepare('SELECT * FROM stops WHERE trip_number = ? ORDER BY id ASC').all(trip_number);
  const extraPay = db.prepare('SELECT * FROM extra_pay WHERE trip_number = ?').all(trip_number);
  const inventory = db.prepare('SELECT * FROM trailer_inventory ORDER BY last_seen DESC').all();

  if (!trip) {
    return (
      <div className="p-20 text-center text-white bg-black min-h-screen">
        <p className="text-xl font-bold font-mono text-blue-500">Trip {trip_number} not found</p>
      </div>
    );
  }

  return <TripDetailsClient trip={trip} stops={stops} extraPay={extraPay} inventory={inventory} />;
}
