import 'server-only';

import type { RowDataPacket } from 'mysql2/promise';
import { queryRows } from './db';
import type { MysqlReviewerDto } from './types';
import { booleanValue, idString, normalizeReviewerLookup, nullableString } from './values';

interface ReviewerRow extends RowDataPacket {
  internal_id: string;
  access_code: string;
  full_name: string;
  email: string | null;
  is_active: number;
}

function mapReviewer(row: ReviewerRow): MysqlReviewerDto {
  const email = nullableString(row.email);

  return {
    internalId: idString(row.internal_id),
    id: row.access_code,
    name: row.full_name,
    ...(email ? { email } : {}),
    isActive: booleanValue(row.is_active),
  };
}

const REVIEWER_SELECT = `
  SELECT
    CAST(r.id AS CHAR) AS internal_id,
    r.access_code,
    r.full_name,
    r.email,
    r.is_active
  FROM reviewers r`;

export async function listReviewers(options: { includeInactive?: boolean } = {}): Promise<MysqlReviewerDto[]> {
  const rows = await queryRows<ReviewerRow>(`
    ${REVIEWER_SELECT}
    WHERE r.deleted_at IS NULL
      ${options.includeInactive ? '' : 'AND r.is_active = TRUE'}
    ORDER BY r.full_name, r.access_code
  `);

  return rows.map(mapReviewer);
}

export async function getReviewerByInternalId(internalId: string): Promise<MysqlReviewerDto | null> {
  const rows = await queryRows<ReviewerRow>(`
    ${REVIEWER_SELECT}
    WHERE r.id = ? AND r.deleted_at IS NULL
    LIMIT 1
  `, [internalId]);

  return rows[0] ? mapReviewer(rows[0]) : null;
}

export async function getReviewerByAccessCode(accessCode: string): Promise<MysqlReviewerDto | null> {
  const rows = await queryRows<ReviewerRow>(`
    ${REVIEWER_SELECT}
    WHERE LOWER(r.access_code) = LOWER(?)
      AND r.deleted_at IS NULL
      AND r.is_active = TRUE
    LIMIT 1
  `, [accessCode.trim()]);

  return rows[0] ? mapReviewer(rows[0]) : null;
}

export async function findReviewerByAccess(input: string): Promise<MysqlReviewerDto | null> {
  const normalized = normalizeReviewerLookup(input);
  if (!normalized) return null;

  const rows = await queryRows<ReviewerRow>(`
    ${REVIEWER_SELECT}
    WHERE r.deleted_at IS NULL
      AND r.is_active = TRUE
      AND (
        LOWER(r.access_code) = LOWER(?)
        OR LOWER(r.full_name) = LOWER(?)
        OR EXISTS (
          SELECT 1
          FROM reviewer_aliases ra
          WHERE ra.reviewer_id = r.id
            AND ra.deleted_at IS NULL
            AND ra.normalized_alias = ?
        )
      )
    ORDER BY CASE WHEN LOWER(r.access_code) = LOWER(?) THEN 0 ELSE 1 END
    LIMIT 1
  `, [input.trim(), input.trim(), normalized, input.trim()]);

  return rows[0] ? mapReviewer(rows[0]) : null;
}

