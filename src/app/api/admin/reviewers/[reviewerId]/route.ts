import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader } from 'mysql2';
import { findReviewerByAccess, listProtocols, mysqlPool } from '@/lib/mysql';

export const runtime = 'nodejs';

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ reviewerId: string }> }
) {
  try {
    const { reviewerId } = await context.params;
    const reviewer = await findReviewerByAccess(decodeURIComponent(reviewerId));
    if (!reviewer) {
      return NextResponse.json({ error: 'Reviewer not found.' }, { status: 404 });
    }

    const protocols = await listProtocols({ reviewerInternalId: reviewer.internalId });

    return NextResponse.json({
      reviewer: { id: reviewer.id, name: reviewer.name, email: reviewer.email || '' },
      protocols,
    });
  } catch (error) {
    console.error('Failed to load reviewer profile:', error);
    return NextResponse.json({ error: 'Failed to load reviewer profile.' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ reviewerId: string }> }
) {
  try {
    const { reviewerId } = await context.params;
    const id = decodeURIComponent(reviewerId);
    const payload = await request.json() as Record<string, unknown>;
    const name = cleanString(payload.name);
    const email = cleanString(payload.email);

    if (!name) {
      return NextResponse.json({ error: 'Reviewer name is required.' }, { status: 400 });
    }
    if (email && !isValidEmail(email)) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }

    const [result] = await mysqlPool.execute<ResultSetHeader>(`
      UPDATE reviewers
      SET full_name = ?, email = NULLIF(?, '')
      WHERE access_code = ? AND is_active = TRUE AND deleted_at IS NULL
    `, [name, email, id]);

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: 'Reviewer not found.' }, { status: 404 });
    }
    return NextResponse.json({ reviewer: { id, name, email } });
  } catch (error) {
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ error: 'That email already belongs to another reviewer.' }, { status: 409 });
    }
    console.error('Failed to update reviewer:', error);
    return NextResponse.json({ error: 'Failed to update reviewer.' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ reviewerId: string }> }
) {
  try {
    const { reviewerId } = await context.params;
    const [result] = await mysqlPool.execute<ResultSetHeader>(`
      UPDATE reviewers
      SET is_active = FALSE, deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP(6))
      WHERE access_code = ? AND is_active = TRUE AND deleted_at IS NULL
    `, [decodeURIComponent(reviewerId)]);

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: 'Reviewer not found.' }, { status: 404 });
    }
    return NextResponse.json({ archived: true });
  } catch (error) {
    console.error('Failed to archive reviewer:', error);
    return NextResponse.json({ error: 'Failed to archive reviewer.' }, { status: 500 });
  }
}
