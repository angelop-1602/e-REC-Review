import { NextRequest, NextResponse } from 'next/server';
import { listProtocols, saveProtocol } from '@/lib/mysql';

export const runtime = 'nodejs';

function compatibleProtocol(protocol: Awaited<ReturnType<typeof listProtocols>>[number]) {
  return {
    ...protocol,
    protocolKey: protocol.internalId,
    reviewers: protocol.reviewers.map((reviewer) => ({
      ...reviewer,
      assignmentId: reviewer.internalId,
    })),
  };
}

export async function GET(request: NextRequest) {
  try {
    const protocols = await listProtocols({
      monthId: request.nextUrl.searchParams.get('monthId') || undefined,
      weekId: request.nextUrl.searchParams.get('weekId') || undefined,
    });
    return NextResponse.json({ protocols: protocols.map(compatibleProtocol) });
  } catch (error) {
    console.error('Failed to list MySQL protocols:', error);
    return NextResponse.json({ error: 'Failed to load protocols.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const protocolKey = await saveProtocol({
      monthId: String(body.monthId || ''),
      weekId: String(body.weekId || ''),
      protocol: body.protocol || {},
      upsert: Boolean(body.upsert),
    });
    return NextResponse.json({ protocolKey }, { status: 201 });
  } catch (error) {
    console.error('Failed to save MySQL protocol:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save protocol.' },
      { status: 400 }
    );
  }
}
