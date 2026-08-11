import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { mysqlPool } from '@/lib/mysql';

export const runtime = 'nodejs';

interface SystemNoticeRow extends RowDataPacket {
  id: number;
  notice_number: number;
  title: string;
  subtitle: string | null;
  message: string;
  action_text: string | null;
  action_href: string | null;
  published_at: Date | string;
  expires_at: Date | string | null;
  point_order: number | null;
  point_content: string | null;
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
    const [rows] = await mysqlPool.execute<SystemNoticeRow[]>(`
      SELECT
        sn.id,
        sn.notice_number,
        sn.title,
        sn.subtitle,
        sn.message,
        sn.action_text,
        sn.action_href,
        sn.published_at,
        sn.expires_at,
        kp.display_order AS point_order,
        kp.content AS point_content
      FROM system_notices sn
      LEFT JOIN system_notice_key_points kp ON kp.system_notice_id = sn.id
      WHERE sn.deleted_at IS NULL
        AND (sn.expires_at IS NULL OR sn.expires_at > CURRENT_TIMESTAMP(6))
      ORDER BY sn.expires_at IS NULL, sn.expires_at, sn.published_at DESC, kp.display_order
    `);

    const notices = new Map<number, {
      id: string;
      title: string;
      subtitle: string;
      message: string;
      noticeNumber: number;
      created_at: string | null;
      expires_at: string | null;
      keyPoints: string[];
      actionButton?: { text: string; href: string };
    }>();
    for (const row of rows) {
      const notice = notices.get(row.id) || {
        id: String(row.id),
        title: row.title,
        subtitle: row.subtitle || '',
        message: row.message,
        noticeNumber: row.notice_number,
        created_at: toIso(row.published_at),
        expires_at: toIso(row.expires_at),
        keyPoints: [],
        ...(row.action_text && row.action_href
          ? { actionButton: { text: row.action_text, href: row.action_href } }
          : {}),
      };
      if (row.point_content) notice.keyPoints.push(row.point_content);
      notices.set(row.id, notice);
    }
    return NextResponse.json({ notices: Array.from(notices.values()) });
  } catch (error) {
    console.error('Failed to load system notices:', error);
    return NextResponse.json({ error: 'Failed to load system notices.' }, { status: 500 });
  }
}
