import 'server-only';

import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { queryRows, withTransaction, type MysqlParameter } from './db';
import type {
  MysqlProtocolDto,
  MysqlReviewerAssignmentDto,
  MysqlReviewerProtocolDto,
} from './types';
import {
  databaseStatus,
  dateOnly,
  displayStatus,
  idString,
  isoDateTime,
} from './values';

interface ProtocolJoinRow extends RowDataPacket {
  protocol_internal_id: string;
  source_document_id: string;
  rec_code: string;
  research_title: string;
  principal_investigator: string;
  adviser: string;
  course_program: string;
  document_link: string | null;
  protocol_status: string;
  protocol_due_date: string | null;
  protocol_created_at: string | null;
  month_key: string;
  week_key: string;
  week_number: number;
  assignment_internal_id: string | null;
  assignment_source_id: string | null;
  assignment_source_name: string | null;
  reviewer_access_code: string | null;
  reviewer_full_name: string | null;
  assignment_status: string | null;
  form_type: string | null;
  assignment_due_date: string | null;
  assignment_completed_at: string | null;
}

export interface ProtocolFilters {
  monthId?: string;
  weekId?: string;
  reviewerInternalId?: string;
  protocolInternalId?: string;
  includeDeleted?: boolean;
}

function releasePeriod(monthKey: string, weekNumber: number): string {
  const match = monthKey.match(/^([A-Za-z]+)(\d{4})$/);
  const monthLabel = match ? `${match[1]} ${match[2]}` : monthKey;
  return `${monthLabel} Week ${weekNumber}`;
}

function mapProtocols(rows: ProtocolJoinRow[]): MysqlProtocolDto[] {
  const protocols = new Map<string, MysqlProtocolDto>();

  for (const row of rows) {
    const protocolId = idString(row.protocol_internal_id);
    let protocol = protocols.get(protocolId);

    if (!protocol) {
      const createdAt = isoDateTime(row.protocol_created_at) ?? '';
      const link = row.document_link ?? '';

      protocol = {
        internalId: protocolId,
        id: row.source_document_id,
        protocol_name: row.research_title,
        release_period: releasePeriod(row.month_key, row.week_number),
        academic_level: row.course_program,
        reviewers: [],
        due_date: dateOnly(row.protocol_due_date),
        status: displayStatus(row.protocol_status),
        protocol_file: link,
        created_at: createdAt,
        research_title: row.research_title,
        e_link: link,
        course_program: row.course_program,
        spup_rec_code: row.rec_code,
        principal_investigator: row.principal_investigator,
        adviser: row.adviser,
        monthId: row.month_key,
        weekId: row.week_key,
        _path: `${row.month_key}/${row.week_key}/${row.source_document_id}`,
      };
      protocols.set(protocolId, protocol);
    }

    if (row.assignment_internal_id) {
      const assignment: MysqlReviewerAssignmentDto = {
        internalId: idString(row.assignment_internal_id),
        id: row.reviewer_access_code ?? row.assignment_source_id ?? '',
        name: row.reviewer_full_name ?? row.assignment_source_name ?? '',
        status: displayStatus(row.assignment_status),
        form_type: row.form_type ?? '',
        due_date: dateOnly(row.assignment_due_date),
        completed_at: isoDateTime(row.assignment_completed_at),
      };
      protocol.reviewers.push(assignment);
    }
  }

  return [...protocols.values()];
}

export async function listProtocols(filters: ProtocolFilters = {}): Promise<MysqlProtocolDto[]> {
  const clauses = [filters.includeDeleted ? '1 = 1' : 'p.deleted_at IS NULL'];
  const values: MysqlParameter[] = [];

  if (filters.monthId) {
    clauses.push('pm.legacy_month_key = ?');
    values.push(filters.monthId);
  }
  if (filters.weekId) {
    clauses.push('pw.legacy_week_key = ?');
    values.push(filters.weekId);
  }
  if (filters.reviewerInternalId) {
    clauses.push('pra.reviewer_id = ?');
    values.push(filters.reviewerInternalId);
  }
  if (filters.protocolInternalId) {
    clauses.push('p.id = ?');
    values.push(filters.protocolInternalId);
  }

  const rows = await queryRows<ProtocolJoinRow>(`
    SELECT
      CAST(p.id AS CHAR) AS protocol_internal_id,
      p.source_document_id,
      p.rec_code,
      p.research_title,
      p.principal_investigator,
      p.adviser,
      p.course_program,
      p.document_link,
      p.status AS protocol_status,
      p.due_date AS protocol_due_date,
      COALESCE(p.source_created_at, p.created_at) AS protocol_created_at,
      pm.legacy_month_key AS month_key,
      pw.legacy_week_key AS week_key,
      pw.week_number,
      CAST(pra.id AS CHAR) AS assignment_internal_id,
      pra.source_reviewer_id AS assignment_source_id,
      pra.source_reviewer_name AS assignment_source_name,
      r.access_code AS reviewer_access_code,
      r.full_name AS reviewer_full_name,
      pra.status AS assignment_status,
      COALESCE(pra.form_type_code, pra.source_form_type) AS form_type,
      pra.due_date AS assignment_due_date,
      pra.completed_at AS assignment_completed_at
    FROM protocols p
    INNER JOIN protocol_weeks pw ON pw.id = p.protocol_week_id
    INNER JOIN protocol_months pm ON pm.id = pw.protocol_month_id
    LEFT JOIN protocol_reviewer_assignments pra
      ON pra.protocol_id = p.id AND pra.deleted_at IS NULL
    LEFT JOIN reviewers r ON r.id = pra.reviewer_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY pm.calendar_year DESC, pm.calendar_month DESC,
      pw.week_number, p.rec_code, pra.assignment_slot
  `, values);

  return mapProtocols(rows);
}

export async function getProtocolByInternalId(internalId: string): Promise<MysqlProtocolDto | null> {
  const protocols = await listProtocols({ protocolInternalId: internalId });
  return protocols[0] ?? null;
}

export async function listReviewerAssignments(reviewerInternalId: string): Promise<MysqlReviewerProtocolDto[]> {
  const protocols = await listProtocols({ reviewerInternalId });

  return protocols.flatMap((protocol) => protocol.reviewers
    .filter((assignment) => assignment.internalId)
    .map((reviewer) => ({ assignmentId: reviewer.internalId, protocol, reviewer })));
}

export async function updateReviewerAssignmentStatus(input: {
  reviewerInternalId: string;
  assignmentId: string;
  status: 'Completed' | 'In Progress' | 'completed' | 'in_progress';
}): Promise<MysqlReviewerProtocolDto> {
  const results = await updateReviewerAssignmentStatuses({
    reviewerInternalId: input.reviewerInternalId,
    assignmentIds: [input.assignmentId],
    status: input.status,
  });
  if (!results[0]) throw new Error('Updated assignment could not be reloaded.');
  return results[0];
}

export async function updateReviewerAssignmentStatuses(input: {
  reviewerInternalId: string;
  assignmentIds: string[];
  status: 'Completed' | 'In Progress' | 'completed' | 'in_progress';
}): Promise<MysqlReviewerProtocolDto[]> {
  const status = databaseStatus(input.status);
  const assignmentIds = [...new Set(input.assignmentIds.map((id) => id.trim()).filter(Boolean))];
  if (assignmentIds.length === 0) return [];
  const placeholders = assignmentIds.map(() => '?').join(', ');

  const protocolIds = await withTransaction(async (connection) => {
    const rows = await queryRows<RowDataPacket & { assignment_id: string; protocol_id: string }>(`
      SELECT CAST(id AS CHAR) AS assignment_id, CAST(protocol_id AS CHAR) AS protocol_id
      FROM protocol_reviewer_assignments
      WHERE id IN (${placeholders}) AND reviewer_id = ? AND deleted_at IS NULL
      FOR UPDATE
    `, [...assignmentIds, input.reviewerInternalId], connection);

    if (rows.length !== assignmentIds.length) {
      throw new Error('One or more reviewer assignments were not found or are not owned by this reviewer.');
    }

    await connection.execute<ResultSetHeader>(`
      UPDATE protocol_reviewer_assignments
      SET status = ?,
          completed_at = CASE WHEN ? = 'completed' THEN UTC_TIMESTAMP(6) ELSE NULL END
      WHERE id IN (${placeholders}) AND reviewer_id = ?
    `, [status, status, ...assignmentIds, input.reviewerInternalId]);

    const affectedProtocolIds = [...new Set(rows.map((row) => idString(row.protocol_id)))];
    for (const protocolId of affectedProtocolIds) {
      const aggregate = await queryRows<RowDataPacket & {
        total: number;
        completed: number;
        completed_at: string | null;
      }>(`
        SELECT COUNT(*) AS total, SUM(status = 'completed') AS completed,
          MAX(completed_at) AS completed_at
        FROM protocol_reviewer_assignments
        WHERE protocol_id = ? AND deleted_at IS NULL
      `, [protocolId], connection);
      const allCompleted = Number(aggregate[0]?.total ?? 0) > 0
        && Number(aggregate[0]?.total) === Number(aggregate[0]?.completed);

      await connection.execute<ResultSetHeader>(`
        UPDATE protocols SET status = ?, completed_at = ?
        WHERE id = ? AND deleted_at IS NULL
      `, [allCompleted ? 'completed' : 'in_progress', allCompleted ? aggregate[0]?.completed_at : null, protocolId]);
    }

    for (const row of rows) {
      await connection.execute<ResultSetHeader>(`
        INSERT INTO protocol_assignment_events (
          protocol_id, assignment_id, event_type, to_reviewer_id,
          status_after, occurred_at, completed_at, actor_type, actor_identifier
        ) VALUES (?, ?, 'status_change', ?, ?, UTC_TIMESTAMP(6),
          CASE WHEN ? = 'completed' THEN UTC_TIMESTAMP(6) ELSE NULL END,
          'reviewer', ?)
      `, [row.protocol_id, row.assignment_id, input.reviewerInternalId, status, status, input.reviewerInternalId]);
    }

    return affectedProtocolIds;
  });

  const refreshed = await listReviewerAssignments(input.reviewerInternalId);
  const assignmentSet = new Set(assignmentIds);
  const results = refreshed.filter((item) =>
    assignmentSet.has(item.assignmentId) && protocolIds.includes(item.protocol.internalId));
  if (results.length !== assignmentIds.length) throw new Error('Updated assignments could not be reloaded.');
  return results;
}
