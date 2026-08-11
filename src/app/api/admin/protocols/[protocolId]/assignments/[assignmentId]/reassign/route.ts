import { NextRequest, NextResponse } from 'next/server';
import { reassignProtocolAssignment } from '@/lib/mysql';

export const runtime = 'nodejs';

export async function POST(request: NextRequest, context: {
  params: Promise<{ protocolId: string; assignmentId: string }>;
}) {
  try {
    const [{ protocolId, assignmentId }, body] = await Promise.all([context.params, request.json()]);
    await reassignProtocolAssignment({
      protocolId,
      assignmentId,
      reviewerCode: String(body.reviewerCode || ''),
      status: String(body.status || 'In Progress'),
      dueDate: body.dueDate,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to reassign protocol:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to reassign protocol.' },
      { status: 400 }
    );
  }
}
