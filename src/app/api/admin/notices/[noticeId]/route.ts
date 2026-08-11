import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader } from 'mysql2';
import { mysqlPool } from '@/lib/mysql';

export const runtime = 'nodejs';

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseId(value: string): number | null {
  return /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : null;
}

function parseExpiry(value: unknown): string | null | undefined {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? undefined
    : `${value} 00:00:00.000000`;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ noticeId: string }> }
) {
  try {
    const { noticeId } = await context.params;
    const id = parseId(noticeId);
    if (!id) return NextResponse.json({ error: 'Invalid notice ID.' }, { status: 400 });

    const payload = await request.json() as Record<string, unknown>;
    const title = cleanString(payload.title);
    const content = cleanString(payload.content);
    const priority = cleanString(payload.priority) || 'none';
    const expiresAt = parseExpiry(payload.expiresAt);

    if (!title || !content) {
      return NextResponse.json({ error: 'Title and content are required.' }, { status: 400 });
    }
    if (!['none', 'low', 'medium', 'high'].includes(priority)) {
      return NextResponse.json({ error: 'Invalid notice priority.' }, { status: 400 });
    }
    if (expiresAt === undefined) {
      return NextResponse.json({ error: 'Expiration date must use YYYY-MM-DD.' }, { status: 400 });
    }

    const [result] = await mysqlPool.execute<ResultSetHeader>(`
      UPDATE notices
      SET title = ?, content = ?, priority = ?, expires_at = ?
      WHERE id = ? AND deleted_at IS NULL
    `, [title, content, priority, expiresAt, id]);
    if (result.affectedRows === 0) {
      return NextResponse.json({ error: 'Notice not found.' }, { status: 404 });
    }
    return NextResponse.json({ updated: true });
  } catch (error) {
    console.error('Failed to update notice:', error);
    return NextResponse.json({ error: 'Failed to update notice.' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ noticeId: string }> }
) {
  try {
    const { noticeId } = await context.params;
    const id = parseId(noticeId);
    if (!id) return NextResponse.json({ error: 'Invalid notice ID.' }, { status: 400 });

    const [result] = await mysqlPool.execute<ResultSetHeader>(`
      UPDATE notices
      SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP(6))
      WHERE id = ? AND deleted_at IS NULL
    `, [id]);
    if (result.affectedRows === 0) {
      return NextResponse.json({ error: 'Notice not found.' }, { status: 404 });
    }
    return NextResponse.json({ archived: true });
  } catch (error) {
    console.error('Failed to archive notice:', error);
    return NextResponse.json({ error: 'Failed to archive notice.' }, { status: 500 });
  }
}
