import { NextResponse } from 'next/server';

// Proxy to TruckerCalc's geocode autocomplete (port 3010 on same machine)
// TruckerCalc has the ORS API key stored in its DB and handles the ORS API call
const TRUCKERC_GEOCODE = 'http://localhost:3010/api/geocode/autocomplete';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');

  if (!q || q.length < 2) return NextResponse.json([]);

  try {
    const res = await fetch(`${TRUCKERC_GEOCODE}?q=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return NextResponse.json([]);
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([]);
  }
}
