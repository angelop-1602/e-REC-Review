import { NextRequest, NextResponse } from 'next/server';
import { moveProtocolWeekMysql } from '@/lib/mysql';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sourceMonthId = String(body.sourceMonthId || '');
    const targetMonthId = String(body.targetMonthId || '');
    const weekId = String(body.weekId || '');
    const movedCount = await moveProtocolWeekMysql({ sourceMonthId, targetMonthId, weekId });
    return NextResponse.json({ movedCount, sourceMonthId, targetMonthId, weekId });
  } catch (error) {
    console.error('Failed to move protocol week:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to move protocol week.' },
      { status: 400 }
    );
  }
}
