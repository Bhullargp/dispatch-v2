import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/require-auth';
import { db } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    
    let mileage = await db().get('SELECT * FROM mileage_rates WHERE id = 1', []) as any;
    if (!mileage) {
      await db().run('INSERT INTO mileage_rates (id, us_per_mile, canada_under_1000, canada_over_1000) VALUES (1, 1.06, 1.26, 1.16)', []);
      mileage = { us_per_mile: 1.06, canada_under_1000: 1.26, canada_over_1000: 1.16 };
    }
    
    const provinces = await db().query('SELECT code, rate FROM province_rates', []);
    const provinceRates = Object.fromEntries(provinces.map((p: any) => [p.code, p.rate]));
    
    const states = await db().query('SELECT code, rate FROM state_rates', []);
    const stateRates = Object.fromEntries(states.map((s: any) => [s.code, s.rate]));
    
    return NextResponse.json({ mileage, provinces: provinceRates, states: stateRates });
  } catch (error) {
    console.error('Error fetching mileage rates:', error);
    return NextResponse.json({ error: 'Failed to fetch rates' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    const body = await request.json();
    
    if (body.mileage) {
      await db().run(
        `UPDATE mileage_rates SET us_per_mile = $1, canada_under_1000 = $2, canada_over_1000 = $3 WHERE id = 1`,
        [body.mileage.us_per_mile, body.mileage.canada_under_1000, body.mileage.canada_over_1000]
      );
    }
    
    if (body.provinces) {
      for (const [code, rate] of Object.entries(body.provinces)) {
        await db().run(
          `INSERT INTO province_rates (code, rate) VALUES ($1, $2) ON CONFLICT(code) DO UPDATE SET rate = EXCLUDED.rate`,
          [code, rate]
        );
      }
    }
    
    if (body.states) {
      for (const [code, rate] of Object.entries(body.states)) {
        await db().run(
          `INSERT INTO state_rates (code, rate) VALUES ($1, $2) ON CONFLICT(code) DO UPDATE SET rate = EXCLUDED.rate`,
          [code, rate]
        );
      }
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving mileage rates:', error);
    return NextResponse.json({ error: 'Failed to save rates' }, { status: 500 });
  }
}
