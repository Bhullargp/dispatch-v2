import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');

export async function GET() {
  try {
    const db = new Database(dbPath);
    
    // Create table if not exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS mileage_rates (
        id INTEGER PRIMARY KEY,
        us_per_mile REAL DEFAULT 1.06,
        canada_under_1000 REAL DEFAULT 1.26,
        canada_over_1000 REAL DEFAULT 1.16
      )
    `);
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS province_rates (
        code TEXT PRIMARY KEY,
        rate REAL DEFAULT 1.26
      )
    `);
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS state_rates (
        code TEXT PRIMARY KEY,
        rate REAL DEFAULT 1.06
      )
    `);
    
    // Get mileage rates
    let mileage = db.prepare('SELECT * FROM mileage_rates WHERE id = 1').get();
    if (!mileage) {
      db.prepare('INSERT INTO mileage_rates (id, us_per_mile, canada_under_1000, canada_over_1000) VALUES (1, 1.06, 1.26, 1.16)').run();
      mileage = { us_per_mile: 1.06, canada_under_1000: 1.26, canada_over_1000: 1.16 };
    }
    
    // Get province rates
    const provinces = db.prepare('SELECT code, rate FROM province_rates').all();
    const provinceRates = Object.fromEntries(provinces.map((p: any) => [p.code, p.rate]));
    
    // Get state rates
    const states = db.prepare('SELECT code, rate FROM state_rates').all();
    const stateRates = Object.fromEntries(states.map((s: any) => [s.code, s.rate]));
    
    db.close();
    return NextResponse.json({ 
      mileage, 
      provinces: provinceRates, 
      states: stateRates 
    });
  } catch (error) {
    console.error('Error fetching mileage rates:', error);
    return NextResponse.json({ error: 'Failed to fetch rates' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const db = new Database(dbPath);
    const body = await request.json();
    
    // Update mileage rates
    if (body.mileage) {
      db.prepare(`
        UPDATE mileage_rates 
        SET us_per_mile = ?, canada_under_1000 = ?, canada_over_1000 = ?
        WHERE id = 1
      `).run(body.mileage.us_per_mile, body.mileage.canada_under_1000, body.mileage.canada_over_1000);
    }
    
    // Update province rates
    if (body.provinces) {
      const insertProvince = db.prepare('INSERT OR REPLACE INTO province_rates (code, rate) VALUES (?, ?)');
      Object.entries(body.provinces).forEach(([code, rate]) => {
        insertProvince.run(code, rate);
      });
    }
    
    // Update state rates
    if (body.states) {
      const insertState = db.prepare('INSERT OR REPLACE INTO state_rates (code, rate) VALUES (?, ?)');
      Object.entries(body.states).forEach(([code, rate]) => {
        insertState.run(code, rate);
      });
    }
    
    db.close();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving mileage rates:', error);
    return NextResponse.json({ error: 'Failed to save rates' }, { status: 500 });
  }
}
