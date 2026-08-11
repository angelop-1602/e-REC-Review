import { NextResponse } from 'next/server';
import { loadProtocolDtos } from '../_shared';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return NextResponse.json({ protocols: await loadProtocolDtos() });
  } catch (error) {
    console.error('Failed to load reviewer protocol periods:', error);
    return NextResponse.json({ error: 'Failed to load protocol periods.' }, { status: 500 });
  }
}
