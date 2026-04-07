import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/require-auth';
import { db } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;

    // Get base mileage rates (single source of truth)
    let mileage = await db().get('SELECT * FROM mileage_rates WHERE id = 1', []) as any;
    if (!mileage) {
      await db().run('INSERT INTO mileage_rates (id, us_per_mile, canada_under_1000, canada_over_1000) VALUES (1, 1.06, 1.26, 1.16)', []);
      mileage = { us_per_mile: 1.06, canada_under_1000: 1.26, canada_over_1000: 1.16 };
    }

    let rates = await db().query('SELECT * FROM pay_rates', []);
    
    if (rates.length === 0) {
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
      
      for (const r of defaultRates) {
        await db().run('INSERT INTO pay_rates (name, rate, unit) VALUES ($1, $2, $3)', [r.name, r.rate, r.unit]);
      }
      rates = await db().query('SELECT * FROM pay_rates', []);
    }
    
    return NextResponse.json({ mileage, rates });
  } catch (error) {
    console.error('Error fetching rates:', error);
    return NextResponse.json({ error: 'Failed to fetch rates' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    const body = await request.json();
    
    if (body.rates && Array.isArray(body.rates)) {
      for (const r of body.rates as any[]) {
        await db().run('UPDATE pay_rates SET rate = $1, unit = $2 WHERE name = $3', [r.rate, r.unit, r.name]);
      }
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving rates:', error);
    return NextResponse.json({ error: 'Failed to save rates' }, { status: 500 });
  }
}
