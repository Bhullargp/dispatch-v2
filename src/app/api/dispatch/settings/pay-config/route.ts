import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';

export async function GET(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const userId = access.session.userId;

    // Single source of truth: mileage_rates table
    let mileage = await db().get('SELECT * FROM mileage_rates WHERE id = 1', []) as any;
    if (!mileage) {
      await db().run('INSERT INTO mileage_rates (id, us_per_mile, canada_under_1000, canada_over_1000) VALUES (1, 1.06, 1.26, 1.16)', []);
      mileage = { us_per_mile: 1.06, canada_under_1000: 1.26, canada_over_1000: 1.16 };
    }
    const usRate = mileage.us_per_mile;
    const canadaUnder = mileage.canada_under_1000;
    const canadaOver = mileage.canada_over_1000;

    // Get custom pay rules (enabled only)
    const customRules = await db().query(
      "SELECT * FROM custom_pay_rules WHERE user_id = $1 AND enabled = 1 ORDER BY priority DESC, created_at DESC",
      [userId]
    );

    // Get user's extra pay items
    const extraItems = await db().query(
      'SELECT * FROM extra_pay_items WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    // Get user's trip rules
    const tripRules = await db().query(
      "SELECT * FROM trip_rules WHERE user_id = $1 AND enabled = 1",
      [userId]
    );

    // Get user's trip rule settings from user_settings
    const tripRuleSettings = await db().query(
      'SELECT key, value FROM user_settings WHERE user_id = $1 AND key IN ($2, $3, $4)',
      [userId, 'free_wait_hours', 'max_wait_hours', 'max_city_work_hours']
    ) as Array<{ key: string; value: string }>;
    const tripRuleMap = Object.fromEntries(tripRuleSettings.map(s => [s.key, s.value]));

    const freeWaitHours = parseFloat(tripRuleMap['free_wait_hours'] || '3');
    const maxWaitHours = parseFloat(tripRuleMap['max_wait_hours'] || '6');
    const maxCityWorkHours = parseFloat(tripRuleMap['max_city_work_hours'] || '14');

    return NextResponse.json({
      baseRates: { usRate, canadaUnder, canadaOver },
      customRules,
      extraPayItems: extraItems,
      tripRules,
      tripDefaults: { freeWaitHours, maxWaitHours, maxCityWorkHours },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
