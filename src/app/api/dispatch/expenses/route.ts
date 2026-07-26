import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';
import { buildDocumentDownloadUrl, buildSourcePathUrl } from '@/lib/dispatch-documents';
import { ensureTripExpensesReceiptColumns } from '@/lib/trip-expenses';

export async function GET(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;
    await ensureTripExpensesReceiptColumns();

    const url = new URL(request.url);
    const tripNumber = url.searchParams.get('trip_number');
    const payPeriod = url.searchParams.get('pay_period');
    const expenseType = url.searchParams.get('expense_type');

    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (!access.adminMode) {
      conditions.push(`e.user_id = $${idx++}`);
      params.push(access.session.userId);
    }
    if (tripNumber) {
      conditions.push(`e.trip_number = $${idx++}`);
      params.push(tripNumber);
    }
    if (payPeriod) {
      conditions.push(`e.pay_period = $${idx++}`);
      params.push(payPeriod);
    }
    if (expenseType) {
      conditions.push(`e.expense_type = $${idx++}`);
      params.push(expenseType);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await db().query(
      `SELECT e.*, 
              d.id AS linked_document_id,
              d.filename AS linked_document_filename,
              d.s3_key AS linked_document_s3_key,
              d.source_path AS linked_document_source_path
       FROM trip_expenses e
       LEFT JOIN LATERAL (
         SELECT ud.id, ud.filename, ud.s3_key, ud.source_path
         FROM user_documents ud
         WHERE ud.linked_record_type = 'expense'
           AND ud.linked_record_id = e.id
           AND ud.user_id = e.user_id
         ORDER BY ud.uploaded_at DESC, ud.id DESC
         LIMIT 1
       ) d ON TRUE
       ${where}
       ORDER BY e.created_at DESC`,
      params
    );

    const expenses = (rows as any[]).map((row) => ({
      ...row,
      document_url: row.linked_document_s3_key ? buildDocumentDownloadUrl(row.linked_document_s3_key) : null,
      document_source_url: row.linked_document_source_path ? buildSourcePathUrl(row.linked_document_source_path) : null,
    }));

    return NextResponse.json({ expenses });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;
    await ensureTripExpensesReceiptColumns();

    const body = await request.json();
    const { name, amount, expense_type, category, trip_number, pay_period, notes, expense_date, location, currency, source } = body;

    if (!name || amount === undefined || amount === null) {
      return NextResponse.json({ error: 'name and amount required' }, { status: 400 });
    }

    const result = await db().run(
      `INSERT INTO trip_expenses (user_id, trip_number, pay_period, name, amount, expense_type, category, notes, expense_date, location, currency, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        access.session.userId,
        trip_number || null,
        pay_period || null,
        name,
        parseFloat(amount),
        expense_type || 'trip',
        category || 'misc',
        notes || null,
        expense_date || null,
        location || null,
        currency || null,
        source || null,
      ]
    );

    // Get the inserted row id
    const row = await db().get('SELECT currval($1::regclass) as id', ['trip_expenses_id_seq']);

    return NextResponse.json({ success: true, id: row?.id || result.changes });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;
    await ensureTripExpensesReceiptColumns();

    const body = await request.json();
    const { id, name, amount, expense_type, category, trip_number, pay_period, notes, expense_date, location, currency, source } = body;

    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }

    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (name !== undefined) { sets.push(`name = $${idx++}`); params.push(name); }
    if (amount !== undefined) { sets.push(`amount = $${idx++}`); params.push(parseFloat(amount)); }
    if (expense_type !== undefined) { sets.push(`expense_type = $${idx++}`); params.push(expense_type); }
    if (category !== undefined) { sets.push(`category = $${idx++}`); params.push(category); }
    if (trip_number !== undefined) { sets.push(`trip_number = $${idx++}`); params.push(trip_number); }
    if (pay_period !== undefined) { sets.push(`pay_period = $${idx++}`); params.push(pay_period); }
    if (notes !== undefined) { sets.push(`notes = $${idx++}`); params.push(notes); }
    if (expense_date !== undefined) { sets.push(`expense_date = $${idx++}`); params.push(expense_date); }
    if (location !== undefined) { sets.push(`location = $${idx++}`); params.push(location); }
    if (currency !== undefined) { sets.push(`currency = $${idx++}`); params.push(currency); }
    if (source !== undefined) { sets.push(`source = $${idx++}`); params.push(source); }

    if (sets.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    params.push(id);
    const ownerFilter = access.adminMode ? '' : ` AND user_id = $${idx + 1}`;
    if (!access.adminMode) params.push(access.session.userId);

    const result = await db().run(
      `UPDATE trip_expenses SET ${sets.join(', ')} WHERE id = $${idx}${ownerFilter}`,
      params
    );

    if (!result.changes) return NextResponse.json({ error: 'Expense not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const result = access.adminMode
      ? await db().run('DELETE FROM trip_expenses WHERE id = $1', [id])
      : await db().run('DELETE FROM trip_expenses WHERE id = $1 AND user_id = $2', [id, access.session.userId]);

    if (!result.changes) return NextResponse.json({ error: 'Expense not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
