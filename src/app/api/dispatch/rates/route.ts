import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/require-auth';
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');

export async function GET(request: Request) {
  try {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    const db = new Database(dbPath);
    
    // Get custom rates if they exist, otherwise return defaults
    let rates = db.prepare('SELECT * FROM pay_rates').all();
    
    if (rates.length === 0) {
      // Insert default rates
      const defaultRates = [
        { name: 'Trailer Switch', rate: 30, unit: 'qty' },
        { name: 'Extra Delivery', rate: 75, unit: 'qty' },
        { name: 'Extra Pickup', rate: 75, unit: 'qty' },
        { name: 'Self Delivery', rate: 75, unit: 'qty' },
        { name: 'Self Pickup', rate: 75, unit: 'qty' },
        { name: 'Tarping', rate: 75, unit: 'qty' },
        { name: 'Untarping', rate: 25, unit: 'qty' },
        { name: 'Tolls', rate: 1, unit: 'dollar' },
        { name: 'Waiting Time', rate: 30, unit: 'hour' },
        { name: 'City Work', rate: 39, unit: 'hour' },
        { name: 'Trailer Drop', rate: 30, unit: 'qty' },
        { name: 'Layover', rate: 100, unit: 'qty' }
      ];
      
      const insert = db.prepare('INSERT INTO pay_rates (name, rate, unit) VALUES (?, ?, ?)');
      defaultRates.forEach(r => insert.run(r.name, r.rate, r.unit));
      rates = db.prepare('SELECT * FROM pay_rates').all();
    }
    
    db.close();
    return NextResponse.json(rates);
  } catch (error) {
    console.error('Error fetching rates:', error);
    return NextResponse.json({ error: 'Failed to fetch rates' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    const db = new Database(dbPath);
    const body = await request.json();
    
    if (body.rates && Array.isArray(body.rates)) {
      // Update multiple rates
      const update = db.prepare('UPDATE pay_rates SET rate = ?, unit = ? WHERE name = ?');
      
      body.rates.forEach((r: any) => {
        update.run(r.rate, r.unit, r.name);
      });
    }
    
    db.close();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving rates:', error);
    return NextResponse.json({ error: 'Failed to save rates' }, { status: 500 });
  }
}
