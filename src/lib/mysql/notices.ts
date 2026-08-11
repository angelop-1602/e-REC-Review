import 'server-only';

import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { queryRows, withTransaction } from './db';
import type { MysqlNoticeDto, MysqlSystemNoticeDto } from './types';
import { booleanValue, finiteNumber, idString, isoDateTime } from './values';

interface NoticeRow extends RowDataPacket {
  internal_id: string;
  source_document_id: string | null;
  title: string;
  content: string;
  priority: MysqlNoticeDto['priority'];
  published_at: string;
  expires_at: string | null;
  likes_csv: string | null;
  like_count: number;
  liked_by_reviewer: number;
}

interface SystemNoticeRow extends RowDataPacket {
  internal_id: string;
  source_document_id: string | null;
  notice_number: number;
  title: string;
  subtitle: string | null;
  message: string;
  action_text: string | null;
  action_href: string | null;
  published_at: string;
  expires_at: string | null;
  key_points: string | null;
}

export async function listActiveNoticesForReviewer(
  reviewerInternalId?: string,
  now = new Date()
): Promise<MysqlNoticeDto[]> {
  const rows = await queryRows<NoticeRow>(`
    SELECT
      CAST(n.id AS CHAR) AS internal_id,
      n.source_document_id,
      n.title,
      n.content,
      n.priority,
      n.published_at,
      n.expires_at,
      GROUP_CONCAT(CASE WHEN nl.deleted_at IS NULL THEN nl.source_reviewer_id END
        ORDER BY nl.id SEPARATOR ',') AS likes_csv,
      COUNT(CASE WHEN nl.deleted_at IS NULL THEN 1 END) AS like_count,
      COALESCE(MAX(CASE WHEN nl.deleted_at IS NULL AND nl.reviewer_id = ? THEN 1 ELSE 0 END), 0)
        AS liked_by_reviewer
    FROM notices n
    LEFT JOIN notice_likes nl ON nl.notice_id = n.id
    WHERE n.deleted_at IS NULL
      AND (n.expires_at IS NULL OR n.expires_at > ?)
    GROUP BY n.id
    ORDER BY FIELD(n.priority, 'high', 'medium', 'low', 'none'),
      n.published_at DESC
  `, [reviewerInternalId ?? null, now.toISOString().slice(0, 19).replace('T', ' ')]);

  return rows.map((row) => ({
    internalId: idString(row.internal_id),
    id: row.source_document_id ?? idString(row.internal_id),
    title: row.title,
    content: row.content,
    priority: row.priority,
    created_at: isoDateTime(row.published_at) ?? '',
    expires_at: isoDateTime(row.expires_at),
    likes: row.likes_csv ? row.likes_csv.split(',') : [],
    likeCount: finiteNumber(row.like_count),
    likedByReviewer: booleanValue(row.liked_by_reviewer),
  }));
}

export async function toggleNoticeLike(input: {
  noticeInternalId: string;
  reviewerInternalId: string;
}): Promise<{ liked: boolean; likeCount: number }> {
  return withTransaction(async (connection) => {
    const reviewers = await queryRows<RowDataPacket & { access_code: string }>(`
      SELECT access_code FROM reviewers
      WHERE id = ? AND deleted_at IS NULL AND is_active = TRUE
      FOR UPDATE
    `, [input.reviewerInternalId], connection);
    if (!reviewers[0]) throw new Error('Reviewer was not found.');

    const likes = await queryRows<RowDataPacket & { id: string; deleted_at: string | null }>(`
      SELECT CAST(id AS CHAR) AS id, deleted_at
      FROM notice_likes
      WHERE notice_id = ? AND source_reviewer_id = ?
      FOR UPDATE
    `, [input.noticeInternalId, reviewers[0].access_code], connection);

    const liked = !likes[0] || likes[0].deleted_at !== null;
    if (!likes[0]) {
      await connection.execute<ResultSetHeader>(`
        INSERT INTO notice_likes (
          notice_id, reviewer_id, source_reviewer_id, liked_at
        ) VALUES (?, ?, ?, UTC_TIMESTAMP(6))
      `, [input.noticeInternalId, input.reviewerInternalId, reviewers[0].access_code]);
    } else {
      await connection.execute<ResultSetHeader>(`
        UPDATE notice_likes
        SET reviewer_id = ?,
            liked_at = CASE WHEN ? THEN UTC_TIMESTAMP(6) ELSE liked_at END,
            deleted_at = CASE WHEN ? THEN NULL ELSE UTC_TIMESTAMP(6) END
        WHERE id = ?
      `, [input.reviewerInternalId, liked, liked, likes[0].id]);
    }

    const counts = await queryRows<RowDataPacket & { total: number }>(`
      SELECT COUNT(*) AS total FROM notice_likes
      WHERE notice_id = ? AND deleted_at IS NULL
    `, [input.noticeInternalId], connection);

    return { liked, likeCount: finiteNumber(counts[0]?.total) };
  });
}

export async function listActiveSystemNotices(now = new Date()): Promise<MysqlSystemNoticeDto[]> {
  const rows = await queryRows<SystemNoticeRow>(`
    SELECT CAST(sn.id AS CHAR) AS internal_id, sn.source_document_id,
      sn.notice_number, sn.title, sn.subtitle, sn.message, sn.action_text,
      sn.action_href, sn.published_at, sn.expires_at,
      GROUP_CONCAT(snkp.content ORDER BY snkp.display_order SEPARATOR '\\n') AS key_points
    FROM system_notices sn
    LEFT JOIN system_notice_key_points snkp ON snkp.system_notice_id = sn.id
    WHERE sn.deleted_at IS NULL AND (sn.expires_at IS NULL OR sn.expires_at > ?)
    GROUP BY sn.id
    ORDER BY sn.expires_at, sn.published_at DESC
  `, [now.toISOString().slice(0, 19).replace('T', ' ')]);

  return rows.map((row) => ({
    internalId: idString(row.internal_id),
    id: row.source_document_id ?? idString(row.internal_id),
    noticeNumber: finiteNumber(row.notice_number),
    title: row.title,
    subtitle: row.subtitle ?? '',
    message: row.message,
    keyPoints: row.key_points ? row.key_points.split('\n') : [],
    ...(row.action_text && row.action_href
      ? { actionButton: { text: row.action_text, href: row.action_href } }
      : {}),
    created_at: isoDateTime(row.published_at) ?? '',
    expires_at: isoDateTime(row.expires_at),
  }));
}
