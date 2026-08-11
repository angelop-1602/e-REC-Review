import { NextRequest, NextResponse } from 'next/server';
import { listProtocolAudits } from '@/lib/mysql';

export const runtime = 'nodejs';

export async function GET(_request: NextRequest, context: { params: Promise<{ protocolId: string }> }) {
  try {
    const { protocolId } = await context.params;
    return NextResponse.json({ audits: await listProtocolAudits(protocolId) });
  } catch (error) {
    console.error('Failed to load protocol audits:', error);
    return NextResponse.json({ error: 'Failed to load audit history.' }, { status: 500 });
  }
}
