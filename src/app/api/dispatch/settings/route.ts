import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';

export async function GET(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    // Get system defaults as fallback
    const systemDefaults = await db().query('SELECT key, value FROM system_defaults', []) as Array<{ key: string; value: string }>;
    const defaultsMap = Object.fromEntries(systemDefaults.map(s => [s.key, s.value]));

    // Single source of truth: mileage_rates table
    let mileage = await db().get('SELECT * FROM mileage_rates WHERE id = 1', []) as any;
    if (!mileage) {
      await db().run('INSERT INTO mileage_rates (id, us_per_mile, canada_under_1000, canada_over_1000) VALUES (1, 1.06, 1.26, 1.16)', []);
      mileage = { us_per_mile: 1.06, canada_under_1000: 1.26, canada_over_1000: 1.16 };
    }
    const usRate = mileage.us_per_mile;
    const canadaUnder = mileage.canada_under_1000;
    const canadaOver = mileage.canada_over_1000;

    // Ensure display_name column exists
    await db().run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT`);
    // Get profile fields
    const user = await db().get('SELECT setup_complete, display_name, phone, truck_number, trailer_number, avatar_url, avatar_preset FROM users WHERE id = $1', [access.session.userId]) as any;

    // Get custom pay rules
    const customRules = await db().query(
      'SELECT * FROM custom_pay_rules WHERE user_id = $1 ORDER BY priority DESC, created_at DESC',
      [access.session.userId]
    );

    // Get extra pay items
    const extraItems = await db().query(
      'SELECT * FROM extra_pay_items WHERE user_id = $1 ORDER BY created_at DESC',
      [access.session.userId]
    );

    // Get trip rules
    const tripRules = await db().query(
      'SELECT * FROM trip_rules WHERE user_id = $1 ORDER BY created_at DESC',
      [access.session.userId]
    );

    return NextResponse.json({
      setupComplete: !!user?.setup_complete,
      display_name: user?.display_name || '',
      phone: user?.phone || '',
      truck_number: user?.truck_number || '',
      trailer_number: user?.trailer_number || '',
      avatar_url: user?.avatar_url || '',
      avatar_preset: user?.avatar_preset || '',
      baseRates: { usRate, canadaUnder, canadaOver },
      customRules,
      extraPayItems: extraItems,
      tripRules,
      systemDefaults: defaultsMap,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const body = await request.json();
    const userId = access.session.userId;

    // Update base rates - mileage_rates is single source of truth
    if (body.baseRates) {
      const { usRate, canadaUnder, canadaOver } = body.baseRates;
      // Always update mileage_rates (single source of truth)
      await db().run(
        `INSERT INTO mileage_rates (id, us_per_mile, canada_under_1000, canada_over_1000) VALUES (1, $1, $2, $3)
         ON CONFLICT(id) DO UPDATE SET us_per_mile = EXCLUDED.us_per_mile, canada_under_1000 = EXCLUDED.canada_under_1000, canada_over_1000 = EXCLUDED.canada_over_1000`,
        [usRate || 1.06, canadaUnder || 1.26, canadaOver || 1.16]
      );
    }

    // Update profile fields
    if (body.display_name !== undefined || body.phone !== undefined || body.truck_number !== undefined || body.trailer_number !== undefined || body.avatar_preset !== undefined) {
      const updates: string[] = [];
      const values: any[] = [];
      let idx = 1;
      if (body.display_name !== undefined) { updates.push(`display_name = $${idx++}`); values.push(body.display_name); }
      if (body.phone !== undefined) { updates.push(`phone = $${idx++}`); values.push(body.phone); }
      if (body.truck_number !== undefined) { updates.push(`truck_number = $${idx++}`); values.push(body.truck_number); }
      if (body.trailer_number !== undefined) { updates.push(`trailer_number = $${idx++}`); values.push(body.trailer_number); }
      if (body.avatar_preset !== undefined) { updates.push(`avatar_preset = $${idx++}`); values.push(body.avatar_preset); }
      if (updates.length > 0) {
        values.push(userId);
        await db().run(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, values);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const body = await request.json();
    const userId = access.session.userId;

    if (body.action === 'completeSetup') {
      await db().run('UPDATE users SET setup_complete = 1 WHERE id = $1', [userId]);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
