import { NextRequest, NextResponse } from 'next/server';
import { getProtocolByInternalId, saveProtocol, softDeleteProtocol } from '@/lib/mysql';

export const runtime = 'nodejs';

export async function GET(_request: NextRequest, context: { params: Promise<{ protocolId: string }> }) {
  try {
    const { protocolId } = await context.params;
    const protocol = await getProtocolByInternalId(protocolId);
    if (!protocol) return NextResponse.json({ error: 'Protocol not found.' }, { status: 404 });
    return NextResponse.json({
      protocol: {
        ...protocol,
        protocolKey: protocol.internalId,
        reviewers: protocol.reviewers.map((reviewer) => ({ ...reviewer, assignmentId: reviewer.internalId })),
      },
    });
  } catch (error) {
    console.error('Failed to load protocol:', error);
    return NextResponse.json({ error: 'Failed to load protocol.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ protocolId: string }> }) {
  try {
    const { protocolId } = await context.params;
    const current = await getProtocolByInternalId(protocolId);
    if (!current) return NextResponse.json({ error: 'Protocol not found.' }, { status: 404 });
    const body = await request.json();
    await saveProtocol({
      monthId: body.monthId || current.monthId,
      weekId: body.weekId || current.weekId,
      protocol: { ...current, ...(body.protocol || body), internalId: protocolId },
      upsert: true,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to update protocol:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update protocol.' },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ protocolId: string }> }) {
  try {
    const { protocolId } = await context.params;
    await softDeleteProtocol(protocolId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete protocol:', error);
    return NextResponse.json({ error: 'Failed to delete protocol.' }, { status: 500 });
  }
}
