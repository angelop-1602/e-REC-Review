import 'server-only';

import { createHash } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { idString } from './values';
import { queryRows, withTransaction, type MysqlExecutor } from './db';

interface AssignmentInput {
  assignmentId?: string;
  id?: string;
  name?: string;
  form_type?: string;
  status?: string;
  due_date?: string;
  completed_at?: string | null;
}

export interface ProtocolWriteInput {
  protocolKey?: string;
  internalId?: string;
  id?: string;
  spup_rec_code?: string;
  research_title?: string;
  protocol_name?: string;
  principal_investigator?: string;
  adviser?: string;
  course_program?: string;
  academic_level?: string;
  e_link?: string;
  protocol_file?: string;
  status?: string;
  due_date?: string;
  created_at?: string;
  reviewers?: AssignmentInput[];
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parseMonthKey(monthId: string): { year: number; month: number } {
  const match = /^([A-Za-z]+)(\d{4})$/.exec(monthId);
  if (!match) throw new Error('Month must use a value such as August2026.');
  const month = MONTHS.findIndex((value) => value.toLowerCase() === match[1].toLowerCase()) + 1;
  if (!month) throw new Error(`Unknown month in ${monthId}.`);
  return { year: Number(match[2]), month };
}

function parseWeekKey(weekId: string): number {
  const match = /^week-([1-5])$/.exec(weekId);
  if (!match) throw new Error('Week must be week-1 through week-5.');
  return Number(match[1]);
}

function sourceHash(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function databaseStatus(value: string | undefined): 'completed' | 'in_progress' {
  return String(value ?? '').toLowerCase().replace(/\s+/g, '_') === 'completed'
    ? 'completed'
    : 'in_progress';
}

function nullableDate(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

async function ensureWeek(
  executor: MysqlExecutor,
  monthId: string,
  weekId: string
): Promise<string> {
  const { year, month } = parseMonthKey(monthId);
  const weekNumber = parseWeekKey(weekId);
  await executor.execute<ResultSetHeader>(`
    INSERT INTO protocol_months (legacy_month_key, calendar_year, calendar_month)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE legacy_month_key = VALUES(legacy_month_key)
  `, [monthId, year, month]);
  const months = await queryRows<RowDataPacket & { id: string }>(`
    SELECT CAST(id AS CHAR) AS id FROM protocol_months
    WHERE calendar_year = ? AND calendar_month = ? AND deleted_at IS NULL
  `, [year, month], executor);
  const monthKey = idString(months[0]?.id);
  if (!monthKey) throw new Error('Protocol month could not be created.');

  const collectionPath = `protocols/${monthId}/${weekId}`;
  await executor.execute<ResultSetHeader>(`
    INSERT INTO protocol_weeks (
      protocol_month_id, week_number, legacy_week_key,
      legacy_collection_path, legacy_collection_path_sha256
    ) VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      legacy_week_key = VALUES(legacy_week_key), deleted_at = NULL
  `, [monthKey, weekNumber, weekId, collectionPath, sourceHash(collectionPath)]);
  const weeks = await queryRows<RowDataPacket & { id: string }>(`
    SELECT CAST(id AS CHAR) AS id FROM protocol_weeks
    WHERE protocol_month_id = ? AND week_number = ? AND deleted_at IS NULL
  `, [monthKey, weekNumber], executor);
  const weekKey = idString(weeks[0]?.id);
  if (!weekKey) throw new Error('Protocol week could not be created.');
  return weekKey;
}

async function resolveReviewer(executor: MysqlExecutor, assignment: AssignmentInput) {
  const code = String(assignment.id ?? '').trim();
  const name = String(assignment.name ?? '').trim();
  const rows = await queryRows<RowDataPacket & { id: string; access_code: string; full_name: string }>(`
    SELECT CAST(id AS CHAR) AS id, access_code, full_name
    FROM reviewers
    WHERE deleted_at IS NULL AND is_active = TRUE
      AND (LOWER(access_code) = LOWER(?) OR LOWER(full_name) = LOWER(?))
    ORDER BY CASE WHEN LOWER(access_code) = LOWER(?) THEN 0 ELSE 1 END
    LIMIT 1
  `, [code, name, code], executor);
  return rows[0] ?? null;
}

async function replaceAssignments(
  executor: MysqlExecutor,
  protocolId: string,
  sourcePath: string,
  assignments: AssignmentInput[]
) {
  const existing = await queryRows<RowDataPacket & { id: string; assignment_slot: number; due_date: string | null }>(`
    SELECT CAST(id AS CHAR) AS id, assignment_slot, due_date
    FROM protocol_reviewer_assignments
    WHERE protocol_id = ?
    ORDER BY assignment_slot
    FOR UPDATE
  `, [protocolId], executor);
  const bySlot = new Map(existing.map((row) => [Number(row.assignment_slot), {
    id: idString(row.id),
    dueDate: row.due_date,
  }]));

  for (let index = 0; index < assignments.length; index += 1) {
    const assignment = assignments[index];
    const slot = index + 1;
    const reviewer = await resolveReviewer(executor, assignment);
    const status = databaseStatus(assignment.status);
    const completedAt = status === 'completed'
      ? new Date(assignment.completed_at || Date.now()).toISOString().slice(0, 23).replace('T', ' ')
      : null;
    const assignmentPath = `${sourcePath}/reviewers/${slot}`;
    const existingSlot = bySlot.get(slot);
    const dueDate = nullableDate(assignment.due_date) || existingSlot?.dueDate || null;
    const values = [
      reviewer?.id ?? null,
      String(assignment.id ?? reviewer?.access_code ?? ''),
      String(assignment.name ?? reviewer?.full_name ?? assignment.id ?? ''),
      assignment.form_type || null,
      assignment.form_type || null,
      status,
      dueDate,
      completedAt,
      assignmentPath,
      sourceHash(assignmentPath),
      index,
    ];

    const existingId = existingSlot?.id;
    if (existingId) {
      await executor.execute<ResultSetHeader>(`
        UPDATE protocol_reviewer_assignments
        SET reviewer_id = ?, source_reviewer_id = ?, source_reviewer_name = ?,
            form_type_code = ?, source_form_type = ?, status = ?, due_date = ?,
            completed_at = ?, source_path = ?, source_path_sha256 = ?,
            source_ordinal = ?, deleted_at = NULL
        WHERE id = ?
      `, [...values, existingId]);
    } else {
      await executor.execute<ResultSetHeader>(`
        INSERT INTO protocol_reviewer_assignments (
          protocol_id, assignment_slot, reviewer_id, source_reviewer_id,
          source_reviewer_name, form_type_code, source_form_type, status,
          due_date, completed_at, source_path, source_path_sha256,
          source_ordinal, migration_run_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `, [protocolId, slot, ...values]);
    }
  }

  if (assignments.length < existing.length) {
    await executor.execute<ResultSetHeader>(`
      UPDATE protocol_reviewer_assignments
      SET deleted_at = UTC_TIMESTAMP(6)
      WHERE protocol_id = ? AND assignment_slot > ? AND deleted_at IS NULL
    `, [protocolId, assignments.length]);
  }

  const aggregate = await queryRows<RowDataPacket & { total: number; completed: number; completed_at: string | null }>(`
    SELECT COUNT(*) AS total, SUM(status = 'completed') AS completed, MAX(completed_at) AS completed_at
    FROM protocol_reviewer_assignments
    WHERE protocol_id = ? AND deleted_at IS NULL
  `, [protocolId], executor);
  const allCompleted = Number(aggregate[0]?.total ?? 0) > 0
    && Number(aggregate[0]?.total) === Number(aggregate[0]?.completed);
  await executor.execute<ResultSetHeader>(`
    UPDATE protocols SET status = ?, completed_at = ? WHERE id = ?
  `, [allCompleted ? 'completed' : 'in_progress', allCompleted ? aggregate[0]?.completed_at : null, protocolId]);
}

export async function saveProtocol(input: {
  monthId: string;
  weekId: string;
  protocol: ProtocolWriteInput;
  upsert?: boolean;
}): Promise<string> {
  return withTransaction(async (connection) => {
    const weekId = await ensureWeek(connection, input.monthId, input.weekId);
    const protocol = input.protocol;
    const recCode = String(protocol.spup_rec_code || protocol.id || '').trim();
    const researchTitle = String(protocol.research_title || protocol.protocol_name || '').trim();
    if (!recCode || !researchTitle) throw new Error('REC code and research title are required.');

    const requestedInternalId = String(protocol.internalId || protocol.protocolKey || '').trim();
    const existing = requestedInternalId
      ? await queryRows<RowDataPacket & { id: string; source_path: string }>(`
          SELECT CAST(id AS CHAR) AS id, source_path FROM protocols
          WHERE id = ? AND deleted_at IS NULL FOR UPDATE
        `, [requestedInternalId], connection)
      : await queryRows<RowDataPacket & { id: string; source_path: string }>(`
          SELECT CAST(id AS CHAR) AS id, source_path FROM protocols
          WHERE protocol_week_id = ? AND rec_code = ? AND deleted_at IS NULL FOR UPDATE
        `, [weekId, recCode], connection);
    let protocolId = idString(existing[0]?.id);
    const sourcePath = existing[0]?.source_path || `mysql/protocols/${input.monthId}/${input.weekId}/${recCode}`;

    if (protocolId) {
      if (!input.upsert && !requestedInternalId) {
        throw new Error('A protocol with this REC code already exists in the selected week.');
      }
      if (!input.upsert && protocol.internalId && protocol.internalId !== protocolId) {
        throw new Error('A protocol with this REC code already exists in the selected week.');
      }
      await connection.execute<ResultSetHeader>(`
        UPDATE protocols
        SET protocol_week_id = ?, rec_code = ?, research_title = ?, principal_investigator = ?, adviser = ?,
            course_program = ?, document_link = ?, due_date = ?, deleted_at = NULL
        WHERE id = ?
      `, [
        weekId,
        recCode,
        researchTitle,
        protocol.principal_investigator || '',
        protocol.adviser || '',
        protocol.course_program || protocol.academic_level || '',
        protocol.e_link || protocol.protocol_file || null,
        nullableDate(protocol.due_date),
        protocolId,
      ]);
    } else {
      const [result] = await connection.execute<ResultSetHeader>(`
        INSERT INTO protocols (
          protocol_week_id, rec_code, research_title, principal_investigator,
          adviser, course_program, document_link, status, due_date,
          source_document_id, source_path, source_path_sha256, migration_run_id,
          source_created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'in_progress', ?, ?, ?, ?, NULL, ?)
      `, [
        weekId, recCode, researchTitle, protocol.principal_investigator || '',
        protocol.adviser || '', protocol.course_program || protocol.academic_level || '',
        protocol.e_link || protocol.protocol_file || null, nullableDate(protocol.due_date),
        protocol.id || recCode, sourcePath, sourceHash(sourcePath),
        protocol.created_at ? new Date(protocol.created_at) : new Date(),
      ]);
      protocolId = String(result.insertId);
    }

    await replaceAssignments(connection, protocolId, sourcePath, protocol.reviewers || []);
    return protocolId;
  });
}

export async function softDeleteProtocol(protocolId: string): Promise<void> {
  await withTransaction(async (connection) => {
    await connection.execute<ResultSetHeader>(`
      UPDATE protocols SET deleted_at = UTC_TIMESTAMP(6) WHERE id = ? AND deleted_at IS NULL
    `, [protocolId]);
    await connection.execute<ResultSetHeader>(`
      UPDATE protocol_reviewer_assignments SET deleted_at = UTC_TIMESTAMP(6)
      WHERE protocol_id = ? AND deleted_at IS NULL
    `, [protocolId]);
  });
}

export async function reassignProtocolAssignment(input: {
  protocolId: string;
  assignmentId: string;
  reviewerCode: string;
  status: string;
  dueDate?: string;
}): Promise<void> {
  await withTransaction(async (connection) => {
    const assignments = await queryRows<RowDataPacket & {
      reviewer_id: string | null;
      source_reviewer_name: string;
    }>(`
      SELECT CAST(reviewer_id AS CHAR) AS reviewer_id, source_reviewer_name
      FROM protocol_reviewer_assignments
      WHERE id = ? AND protocol_id = ? AND deleted_at IS NULL FOR UPDATE
    `, [input.assignmentId, input.protocolId], connection);
    if (!assignments[0]) throw new Error('Reviewer assignment was not found.');
    const reviewers = await queryRows<RowDataPacket & { id: string; access_code: string; full_name: string }>(`
      SELECT CAST(id AS CHAR) AS id, access_code, full_name FROM reviewers
      WHERE LOWER(access_code) = LOWER(?) AND is_active = TRUE AND deleted_at IS NULL LIMIT 1
    `, [input.reviewerCode], connection);
    if (!reviewers[0]) throw new Error('The selected reviewer was not found.');
    const status = databaseStatus(input.status);
    await connection.execute<ResultSetHeader>(`
      UPDATE protocol_reviewer_assignments
      SET reviewer_id = ?, source_reviewer_id = ?, source_reviewer_name = ?,
          status = ?, due_date = COALESCE(?, due_date),
          completed_at = CASE WHEN ? = 'completed' THEN UTC_TIMESTAMP(6) ELSE NULL END
      WHERE id = ?
    `, [
      reviewers[0].id, reviewers[0].access_code, reviewers[0].full_name,
      status, nullableDate(input.dueDate), status, input.assignmentId,
    ]);
    const aggregate = await queryRows<RowDataPacket & { total: number; completed: number; completed_at: string | null }>(`
      SELECT COUNT(*) AS total, SUM(status = 'completed') AS completed, MAX(completed_at) AS completed_at
      FROM protocol_reviewer_assignments
      WHERE protocol_id = ? AND deleted_at IS NULL
    `, [input.protocolId], connection);
    const allCompleted = Number(aggregate[0]?.total ?? 0) > 0
      && Number(aggregate[0]?.total) === Number(aggregate[0]?.completed);
    await connection.execute<ResultSetHeader>(`
      UPDATE protocols SET status = ?, completed_at = ? WHERE id = ? AND deleted_at IS NULL
    `, [allCompleted ? 'completed' : 'in_progress', allCompleted ? aggregate[0]?.completed_at : null, input.protocolId]);
    await connection.execute<ResultSetHeader>(`
      INSERT INTO protocol_assignment_events (
        protocol_id, assignment_id, event_type, from_reviewer_id, to_reviewer_id,
        source_from_name, source_to_name, status_after, occurred_at, completed_at,
        actor_type, actor_identifier
      ) VALUES (?, ?, 'reassignment', ?, ?, ?, ?, ?, UTC_TIMESTAMP(6),
        CASE WHEN ? = 'completed' THEN UTC_TIMESTAMP(6) ELSE NULL END, 'admin', 'admin')
    `, [
      input.protocolId, input.assignmentId, assignments[0].reviewer_id, reviewers[0].id,
      assignments[0].source_reviewer_name, reviewers[0].full_name, status, status,
    ]);
  });
}

export async function moveProtocolWeekMysql(input: {
  sourceMonthId: string;
  targetMonthId: string;
  weekId: string;
}): Promise<number> {
  return withTransaction(async (connection) => {
    const sourceRows = await queryRows<RowDataPacket & { id: string }>(`
      SELECT CAST(pw.id AS CHAR) AS id FROM protocol_weeks pw
      INNER JOIN protocol_months pm ON pm.id = pw.protocol_month_id
      WHERE pm.legacy_month_key = ? AND pw.legacy_week_key = ?
      FOR UPDATE
    `, [input.sourceMonthId, input.weekId], connection);
    if (!sourceRows[0]) throw new Error('This week no longer contains protocols to move.');
    const targetWeekId = await ensureWeek(connection, input.targetMonthId, input.weekId);
    const conflicts = await queryRows<RowDataPacket & { rec_code: string }>(`
      SELECT target.rec_code
      FROM protocols source
      INNER JOIN protocols target ON target.protocol_week_id = ?
        AND target.rec_code = source.rec_code AND target.deleted_at IS NULL
      WHERE source.protocol_week_id = ? AND source.deleted_at IS NULL
      LIMIT 5
    `, [targetWeekId, sourceRows[0].id], connection);
    if (conflicts.length) throw new Error(`Destination contains duplicate REC code(s): ${conflicts.map((row) => row.rec_code).join(', ')}.`);
    const [result] = await connection.execute<ResultSetHeader>(`
      UPDATE protocols SET protocol_week_id = ?
      WHERE protocol_week_id = ? AND deleted_at IS NULL
    `, [targetWeekId, sourceRows[0].id]);
    return result.affectedRows;
  });
}

export async function listProtocolAudits(protocolId: string) {
  return queryRows<RowDataPacket>(`
    SELECT CAST(id AS CHAR) AS id, source_from_name AS \`from\`, source_to_name AS \`to\`,
      event_type AS type, CASE status_after WHEN 'completed' THEN 'Completed' ELSE 'In Progress' END AS status,
      occurred_at AS date, completed_at
    FROM protocol_assignment_events
    WHERE protocol_id = ?
    ORDER BY occurred_at DESC
  `, [protocolId]);
}
