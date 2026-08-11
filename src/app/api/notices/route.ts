import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { mysqlPool } from '@/lib/mysql';

export const runtime = 'nodejs';

interface NoticeRow extends RowDataPacket {
  id: number;
  title: string;
  content: string;
  priority: string;
  published_at: Date | string;
  expires_at: Date | string | null;
  reviewer_code: string | null;
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return value.toISOString();
}

export async function GET() {
  try {
    const [rows] = await mysqlPool.execute<NoticeRow[]>(`
      SELECT
        n.id,
        n.title,
        n.content,
        n.priority,
        n.published_at,
        n.expires_at,
        nl.source_reviewer_id AS reviewer_code
      FROM notices n
      LEFT JOIN notice_likes nl ON nl.notice_id = n.id AND nl.deleted_at IS NULL
      WHERE n.deleted_at IS NULL
        AND (n.expires_at IS NULL OR n.expires_at > CURRENT_TIMESTAMP(6))
      ORDER BY
        CASE n.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,
        n.expires_at IS NULL,
        n.expires_at,
        n.published_at DESC
    `);

    const notices = new Map<number, {
      id: string;
      title: string;
      content: string;
      priority: string;
      created_at: string | null;
      expires_at: string | null;
      likes: string[];
    }>();
    for (const row of rows) {
      const notice = notices.get(row.id) || {
        id: String(row.id),
        title: row.title,
        content: row.content,
        priority: row.priority,
        created_at: toIso(row.published_at),
        expires_at: toIso(row.expires_at),
        likes: [],
      };
      if (row.reviewer_code && !notice.likes.includes(row.reviewer_code)) notice.likes.push(row.reviewer_code);
      notices.set(row.id, notice);
    }

    const [recentRows] = await mysqlPool.execute<Array<RowDataPacket & { count: number }>>(`
      SELECT COUNT(*) AS count
      FROM notices
      WHERE deleted_at IS NULL
        AND published_at > DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 7 DAY)
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP(6))
    `);

    return NextResponse.json({ notices: Array.from(notices.values()), recentCount: Number(recentRows[0]?.count || 0) });
  } catch (error) {
    console.error('Failed to load active notices:', error);
    return NextResponse.json({ error: 'Failed to load notices.' }, { status: 500 });
  }
}
