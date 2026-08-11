import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import mysql from 'mysql2/promise';

const PORTABLE_BACKUP_ROOT = path.resolve(process.cwd(), 'backups', 'firestore', 'portable');
const REPORT_ROOT = path.resolve(process.cwd(), 'backups', 'mysql', 'reports');
const EXPECTED_COUNTS = Object.freeze({
  rawDocuments: 746,
  protocols: 642,
  assignments: 1879,
  reviewers: 34,
  audits: 4,
  mailBatches: 5,
  mailDeliveries: 60,
  notices: 1,
  noticeLikes: 2,
});

function sha256Buffer(value) {
  return createHash('sha256').update(value).digest();
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function findLatestBackup() {
  const entries = await readdir(PORTABLE_BACKUP_ROOT, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory() && !entry.name.endsWith('.incomplete'))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));
  if (candidates.length === 0) throw new Error(`No completed portable backup found under ${PORTABLE_BACKUP_ROOT}.`);
  return path.join(PORTABLE_BACKUP_ROOT, candidates[0]);
}

function safeDataFile(dataDirectory, fileName) {
  if (typeof fileName !== 'string' || !fileName.endsWith('.ndjson') || path.basename(fileName) !== fileName) {
    throw new Error(`Unsafe backup data filename: ${String(fileName)}`);
  }
  const resolved = path.resolve(dataDirectory, fileName);
  if (!resolved.startsWith(`${path.resolve(dataDirectory)}${path.sep}`)) {
    throw new Error(`Backup data filename escapes data directory: ${fileName}`);
  }
  return resolved;
}

async function readNdjson(filePath, expectedCount, seenPaths) {
  const rows = [];
  const lines = readline.createInterface({ input: createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSON at ${filePath}:${lineNumber}: ${error instanceof Error ? error.message : error}`);
    }
    if (!record || typeof record.path !== 'string' || !record.path.trim()) {
      throw new Error(`Missing Firestore document path at ${filePath}:${lineNumber}.`);
    }
    if (seenPaths.has(record.path)) throw new Error(`Duplicate Firestore path in snapshot: ${record.path}`);
    seenPaths.add(record.path);
    rows.push({ ...record, rawJson: line });
  }
  if (rows.length !== expectedCount) {
    throw new Error(`Record count mismatch for ${path.basename(filePath)}: expected ${expectedCount}, found ${rows.length}.`);
  }
  return rows;
}

async function loadVerifiedSnapshot(requestedDirectory) {
  const backupDirectory = requestedDirectory ? path.resolve(process.cwd(), requestedDirectory) : await findLatestBackup();
  const manifestPath = path.join(backupDirectory, 'manifest.json');
  const dataDirectory = path.join(backupDirectory, 'data');
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.format !== 'e-rec-portable-firestore-backup' || manifest.formatVersion !== 1 || manifest.status !== 'complete') {
    throw new Error(`Unsupported or incomplete portable backup manifest: ${manifestPath}`);
  }
  if (!Array.isArray(manifest.sources)) throw new Error('Backup manifest does not contain a sources array.');

  const seenPaths = new Set();
  const records = [];
  for (const source of manifest.sources) {
    const filePath = safeDataFile(dataDirectory, source.file);
    const actualHash = await sha256File(filePath);
    if (actualHash !== source.sha256) {
      throw new Error(`SHA-256 mismatch for ${source.file}: expected ${source.sha256}, found ${actualHash}.`);
    }
    const rows = await readNdjson(filePath, source.count, seenPaths);
    for (const row of rows) records.push({ ...row, sourceFile: source.file });
  }
  if (seenPaths.size !== manifest.totalDocuments || records.length !== manifest.totalDocuments) {
    throw new Error(`Snapshot total mismatch: manifest=${manifest.totalDocuments}, parsed=${records.length}.`);
  }
  return {
    backupDirectory,
    snapshotName: path.basename(backupDirectory),
    manifest,
    manifestSha256: sha256Hex(manifestBytes),
    records,
  };
}

function unwrapFirestoreValue(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(unwrapFirestoreValue);
  switch (value.__firestoreType) {
    case 'map':
      return Object.fromEntries(Object.entries(value.value ?? {}).map(([key, item]) => [key, unwrapFirestoreValue(item)]));
    case 'array':
      return (value.value ?? []).map(unwrapFirestoreValue);
    case 'timestamp':
      return Object.freeze({
        kind: 'timestamp',
        seconds: Number(value.seconds),
        nanoseconds: Number(value.nanoseconds),
        iso: value.iso,
      });
    case 'geopoint':
      return Object.freeze({ kind: 'geopoint', latitude: value.latitude, longitude: value.longitude });
    case 'bytes':
      return Object.freeze({ kind: 'bytes', base64: value.base64 });
    case 'reference':
      return Object.freeze({ kind: 'reference', path: value.path });
    case 'number':
      if (value.value === 'NaN') return Number.NaN;
      if (value.value === 'Infinity') return Number.POSITIVE_INFINITY;
      if (value.value === '-Infinity') return Number.NEGATIVE_INFINITY;
      throw new Error(`Unsupported tagged number value: ${String(value.value)}`);
    default:
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unwrapFirestoreValue(item)]));
  }
}

function normalizeReviewerName(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function nullableString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function sqlDateTime(value, label) {
  if (value === null || value === undefined || value === '') return null;
  if (value?.kind === 'timestamp') {
    if (!Number.isSafeInteger(value.seconds) || !Number.isInteger(value.nanoseconds) || value.nanoseconds < 0 || value.nanoseconds > 999999999) {
      throw new Error(`Invalid Firestore timestamp for ${label}.`);
    }
    const second = new Date(value.seconds * 1000).toISOString().slice(0, 19).replace('T', ' ');
    return `${second}.${String(value.nanoseconds).padStart(9, '0').slice(0, 6)}`;
  }
  const iso = value;
  if (typeof iso !== 'string' || Number.isNaN(Date.parse(iso))) throw new Error(`Invalid timestamp for ${label}.`);
  const canonical = new Date(iso).toISOString();
  return canonical.slice(0, 23).replace('T', ' ') + '000';
}

function sqlDate(value, label) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid date for ${label}.`);
  return value;
}

function parseWeekNumber(weekId, label) {
  const match = /^week-([1-5])$/.exec(weekId);
  if (!match) throw new Error(`Invalid week ID for ${label}: ${weekId}`);
  return Number(match[1]);
}

function parseProtocolPath(sourcePath) {
  const parts = sourcePath.split('/');
  if (parts.length !== 4 || parts[0] !== 'protocols' || !/^week-[1-5]$/.test(parts[2])) {
    throw new Error(`Unexpected protocol path: ${sourcePath}`);
  }
  return { monthId: parts[1], weekId: parts[2], sourceDocumentId: parts[3] };
}

function parseAuditPath(sourcePath) {
  const parts = sourcePath.split('/');
  if (parts.length !== 6 || parts[0] !== 'protocols' || !/^week-[1-5]$/.test(parts[2]) || parts[4] !== 'audits') {
    throw new Error(`Unexpected audit path: ${sourcePath}`);
  }
  return { protocolPath: parts.slice(0, 4).join('/'), sourceDocumentId: parts[5] };
}

function buildMysqlConfig() {
  const uri = process.env.MYSQL_URL || (process.env.DATABASE_URL?.startsWith('mysql') ? process.env.DATABASE_URL : null);
  if (uri) return { uri, options: { timezone: 'Z', decimalNumbers: true } };
  const database = process.env.MYSQL_DATABASE;
  if (!database) throw new Error('Set MYSQL_URL (recommended) or MYSQL_DATABASE plus MYSQL_HOST/MYSQL_USER/MYSQL_PASSWORD.');
  return {
    options: {
      host: process.env.MYSQL_HOST || '127.0.0.1',
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database,
      timezone: 'Z',
      decimalNumbers: true,
    },
  };
}

async function openConnection() {
  const config = buildMysqlConfig();
  const connection = config.uri
    ? await mysql.createConnection(config.uri)
    : await mysql.createConnection(config.options);
  await connection.query("SET time_zone = '+00:00'");
  return connection;
}

async function insertAndGetId(connection, sql, values) {
  const [result] = await connection.execute(sql, values);
  return Number(result.insertId);
}

function assertExactCount(actual, key) {
  const expected = EXPECTED_COUNTS[key];
  if (actual !== expected) throw new Error(`Preflight ${key} count mismatch: expected ${expected}, found ${actual}.`);
}

function decodedRecords(snapshot) {
  return snapshot.records.map((record) => ({ ...record, decoded: unwrapFirestoreValue(record.data) }));
}

async function writeReport(snapshotName, report) {
  await mkdir(REPORT_ROOT, { recursive: true });
  const reportPath = path.join(REPORT_ROOT, `${snapshotName}-import.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
  return reportPath;
}

// The normalized inserts below intentionally use only explicit columns. This keeps
// the importer deterministic and makes schema drift fail loudly.
async function importSnapshot(connection, snapshot) {
  const records = decodedRecords(snapshot);
  const recordsBySource = new Map();
  for (const record of records) {
    const list = recordsBySource.get(record.source.name) ?? [];
    list.push(record);
    recordsBySource.set(record.source.name, list);
  }

  const reviewerRecords = recordsBySource.get('reviewers') ?? [];
  const protocolRecords = records.filter((record) => /^week-[1-5]$/.test(record.source.name));
  const auditRecords = recordsBySource.get('audits') ?? [];
  const batchRecords = recordsBySource.get('mail_batches') ?? [];
  const deliveryRecords = recordsBySource.get('mail_logs') ?? [];
  const noticeRecords = recordsBySource.get('notices') ?? [];
  const assignmentCount = protocolRecords.reduce(
    (total, record) => total + (Array.isArray(record.decoded.reviewers) ? record.decoded.reviewers.length : 0),
    0
  );
  const noticeLikeCount = noticeRecords.reduce(
    (total, record) => total + (Array.isArray(record.decoded.likes) ? record.decoded.likes.length : 0),
    0
  );

  assertExactCount(records.length, 'rawDocuments');
  assertExactCount(protocolRecords.length, 'protocols');
  assertExactCount(assignmentCount, 'assignments');
  assertExactCount(reviewerRecords.length, 'reviewers');
  assertExactCount(auditRecords.length, 'audits');
  assertExactCount(batchRecords.length, 'mailBatches');
  assertExactCount(deliveryRecords.length, 'mailDeliveries');
  assertExactCount(noticeRecords.length, 'notices');
  assertExactCount(noticeLikeCount, 'noticeLikes');

  const protocolPaths = new Set(protocolRecords.map((record) => record.path));
  for (const audit of auditRecords) {
    const { protocolPath } = parseAuditPath(audit.path);
    if (!protocolPaths.has(protocolPath)) throw new Error(`Audit parent is absent from snapshot: ${audit.path}`);
  }
  const batchIds = new Set(batchRecords.map((record) => record.id));
  for (const delivery of deliveryRecords) {
    if (!batchIds.has(delivery.decoded.batchId)) throw new Error(`Mail delivery has an absent batch: ${delivery.path}`);
  }
  for (const batch of batchRecords) {
    const children = deliveryRecords.filter((delivery) => delivery.decoded.batchId === batch.id);
    if (Number(batch.decoded.total) !== children.length) {
      throw new Error(`Mail batch total does not reconcile for ${batch.path}.`);
    }
    for (const status of ['pending', 'sending', 'sent', 'skipped', 'failed']) {
      const actual = children.filter((delivery) => delivery.decoded.status === status).length;
      if (Number(batch.decoded[status] ?? 0) !== actual) {
        throw new Error(`Mail batch ${status} count does not reconcile for ${batch.path}.`);
      }
    }
  }

  const projectId = requiredString(snapshot.manifest.source?.firebaseProjectId, 'manifest source project ID');
  const databaseId = requiredString(snapshot.manifest.source?.databaseId, 'manifest source database ID');
  const manifestHash = Buffer.from(snapshot.manifestSha256, 'hex');
  const sortedRecords = [...records].sort((left, right) => left.path.localeCompare(right.path));

  await connection.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
  await connection.beginTransaction();
  try {
    const [existingRows] = await connection.execute(
      `SELECT id, status, manifest_sha256, imported_document_count
         FROM migration_runs
        WHERE source_project_id = ? AND source_database_id = ? AND snapshot_label = ?
        FOR UPDATE`,
      [projectId, databaseId, snapshot.snapshotName]
    );
    if (existingRows.length > 0) {
      const existing = existingRows[0];
      const existingHash = Buffer.isBuffer(existing.manifest_sha256)
        ? existing.manifest_sha256.toString('hex')
        : String(existing.manifest_sha256);
      if (existingHash !== snapshot.manifestSha256) {
        throw new Error(`Snapshot label ${snapshot.snapshotName} already exists with a different manifest hash.`);
      }
      if (existing.status !== 'validated' || Number(existing.imported_document_count) !== records.length) {
        throw new Error(`Snapshot ${snapshot.snapshotName} has a non-idempotent existing run in status ${existing.status}.`);
      }
      const rosterAccessCodes = new Set(reviewerRecords.map((record) => record.id));
      const rosterNames = new Set(reviewerRecords.map((record) => normalizeReviewerName(record.decoded.name)));
      const unresolvedAssignments = [];
      for (const protocol of protocolRecords) {
        const assignments = Array.isArray(protocol.decoded.reviewers) ? protocol.decoded.reviewers : [];
        for (let ordinal = 0; ordinal < assignments.length; ordinal += 1) {
          const assignment = assignments[ordinal];
          if (!rosterAccessCodes.has(assignment.id) && !rosterNames.has(normalizeReviewerName(assignment.name))) {
            unresolvedAssignments.push({
              sourcePath: protocol.path,
              sourceOrdinal: ordinal,
              sourceReviewerId: assignment.id,
              sourceReviewerName: assignment.name,
            });
          }
        }
      }
      await connection.rollback();
      return {
        alreadyImported: true,
        report: {
          status: 'already_imported',
          snapshot: snapshot.snapshotName,
          manifestSha256: snapshot.manifestSha256,
          migrationRunId: Number(existing.id),
          importedCounts: {
            rawDocuments: records.length,
            protocols: protocolRecords.length,
            assignments: assignmentCount,
            reviewers: reviewerRecords.length,
            audits: auditRecords.length,
            mailBatches: batchRecords.length,
            mailDeliveries: deliveryRecords.length,
            notices: noticeRecords.length,
            noticeLikes: noticeLikeCount,
          },
          unresolvedAssignments,
        },
      };
    }

    const migrationRunId = await insertAndGetId(
      connection,
      `INSERT INTO migration_runs (
         snapshot_label, source_project_id, source_database_id, source_git_commit,
         backup_started_at, backup_completed_at, import_started_at, manifest_sha256,
         status, source_document_count
       ) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), ?, 'importing', ?)`,
      [
        snapshot.snapshotName,
        projectId,
        databaseId,
        nullableString(snapshot.manifest.sourceGitCommit),
        sqlDateTime(snapshot.manifest.startedAt, 'manifest.startedAt'),
        sqlDateTime(snapshot.manifest.completedAt, 'manifest.completedAt'),
        manifestHash,
        records.length,
      ]
    );

    for (const record of sortedRecords) {
      const payloadJson = JSON.stringify(record.data);
      await connection.execute(
        `INSERT INTO firestore_documents (
           migration_run_id, source_path, source_path_sha256, source_document_id,
           parent_path, source_kind, source_name, payload, payload_sha256
         ) VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?)`,
        [
          migrationRunId,
          record.path,
          sha256Buffer(record.path),
          record.id,
          record.parentPath,
          record.source.kind,
          record.source.name,
          payloadJson,
          sha256Buffer(payloadJson),
        ]
      );
    }

    const reviewerByAccessCode = new Map();
    const reviewerByNormalizedName = new Map();
    const reviewerByEmail = new Map();
    const reviewerRows = [...reviewerRecords].sort((left, right) => left.path.localeCompare(right.path));
    for (const record of reviewerRows) {
      const accessCode = requiredString(record.id, `${record.path}.id`);
      const fullName = requiredString(record.decoded.name, `${record.path}.name`);
      const email = nullableString(record.decoded.email)?.toLowerCase() ?? null;
      const reviewerId = await insertAndGetId(
        connection,
        `INSERT INTO reviewers (
           access_code, full_name, email, source_document_id, source_path,
           source_path_sha256, migration_run_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [accessCode, fullName, email, record.id, record.path, sha256Buffer(record.path), migrationRunId]
      );
      reviewerByAccessCode.set(accessCode, reviewerId);
      const normalizedName = normalizeReviewerName(fullName);
      if (reviewerByNormalizedName.has(normalizedName)) throw new Error(`Duplicate normalized reviewer name in ${record.path}.`);
      reviewerByNormalizedName.set(normalizedName, reviewerId);
      if (email) reviewerByEmail.set(email, reviewerId);
    }

    const aliasOwners = new Map();
    for (const record of reviewerRows) {
      const reviewerId = reviewerByAccessCode.get(record.id);
      const aliases = [
        { value: record.id, type: 'access_code' },
        { value: record.decoded.name, type: 'canonical_name' },
      ];
      for (const alias of aliases) {
        const normalizedAlias = normalizeReviewerName(alias.value);
        const existingOwner = aliasOwners.get(normalizedAlias);
        if (existingOwner && existingOwner !== reviewerId) throw new Error('Reviewer alias normalization collision.');
        if (existingOwner === reviewerId) continue;
        aliasOwners.set(normalizedAlias, reviewerId);
        await connection.execute(
          `INSERT INTO reviewer_aliases (
             reviewer_id, alias_value, normalized_alias, alias_type, migration_run_id
           ) VALUES (?, ?, ?, ?, ?)`,
          [reviewerId, alias.value, normalizedAlias, alias.type, migrationRunId]
        );
      }
    }

    const monthKeys = new Set();
    const weekKeys = new Set();
    for (const record of protocolRecords) {
      const parsed = parseProtocolPath(record.path);
      monthKeys.add(parsed.monthId);
      weekKeys.add(`${parsed.monthId}/${parsed.weekId}`);
    }
    for (const record of [...batchRecords, ...deliveryRecords]) {
      const monthId = nullableString(record.decoded.monthDocumentId);
      const weekId = nullableString(record.decoded.weekId);
      if (monthId) monthKeys.add(monthId);
      if (monthId && weekId && /^week-[1-5]$/.test(weekId)) weekKeys.add(`${monthId}/${weekId}`);
    }

    const monthNames = new Map([
      ['January', 1], ['February', 2], ['March', 3], ['April', 4], ['May', 5], ['June', 6],
      ['July', 7], ['August', 8], ['September', 9], ['October', 10], ['November', 11], ['December', 12],
    ]);
    const parseMonthKey = (monthKey) => {
      const match = /^([A-Za-z]+)(\d{4})$/.exec(monthKey);
      const month = match ? monthNames.get(match[1]) : null;
      if (!match || !month) throw new Error(`Invalid legacy month key: ${monthKey}`);
      return { year: Number(match[2]), month };
    };
    const monthByKey = new Map();
    const sortedMonths = [...monthKeys].sort((left, right) => {
      const a = parseMonthKey(left); const b = parseMonthKey(right);
      return a.year - b.year || a.month - b.month;
    });
    for (const monthKey of sortedMonths) {
      const parsed = parseMonthKey(monthKey);
      const monthId = await insertAndGetId(
        connection,
        `INSERT INTO protocol_months (legacy_month_key, calendar_year, calendar_month, migration_run_id)
         VALUES (?, ?, ?, ?)`,
        [monthKey, parsed.year, parsed.month, migrationRunId]
      );
      monthByKey.set(monthKey, monthId);
    }

    const weekByKey = new Map();
    for (const combinedKey of [...weekKeys].sort()) {
      const [monthKey, weekKey] = combinedKey.split('/');
      const collectionPath = `protocols/${monthKey}/${weekKey}`;
      const weekId = await insertAndGetId(
        connection,
        `INSERT INTO protocol_weeks (
           protocol_month_id, week_number, legacy_week_key, legacy_collection_path,
           legacy_collection_path_sha256, migration_run_id
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [monthByKey.get(monthKey), parseWeekNumber(weekKey, combinedKey), weekKey, collectionPath, sha256Buffer(collectionPath), migrationRunId]
      );
      weekByKey.set(combinedKey, weekId);
    }

    const [formRows] = await connection.query('SELECT code FROM review_form_types');
    const formCodes = new Set(formRows.map((row) => row.code));
    const protocolByPath = new Map();
    const assignmentByProtocolAndName = new Map();
    const unresolvedAssignments = [];
    const unknownFormTypes = new Set();

    const normalizeStatus = (value, label) => {
      const normalized = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '_');
      if (normalized === 'completed' || normalized === 'in_progress') return normalized;
      throw new Error(`Unsupported status for ${label}: ${String(value)}`);
    };
    const resolveReviewer = (sourceId, sourceName) => {
      if (reviewerByAccessCode.has(sourceId)) {
        return { reviewerId: reviewerByAccessCode.get(sourceId), method: 'exact_access_code' };
      }
      const normalizedName = normalizeReviewerName(sourceName);
      if (reviewerByNormalizedName.has(normalizedName)) {
        return { reviewerId: reviewerByNormalizedName.get(normalizedName), method: 'exact_canonical_name' };
      }
      return { reviewerId: null, method: 'unresolved' };
    };

    const sortedProtocols = [...protocolRecords].sort((left, right) => left.path.localeCompare(right.path));
    for (const record of sortedProtocols) {
      const parsed = parseProtocolPath(record.path);
      const assignments = Array.isArray(record.decoded.reviewers) ? record.decoded.reviewers : [];
      const normalizedAssignmentStatuses = assignments.map((assignment, ordinal) =>
        normalizeStatus(assignment.status, `${record.path}.reviewers[${ordinal}].status`)
      );
      const isCompleted = assignments.length > 0 && normalizedAssignmentStatuses.every((status) => status === 'completed');
      const completionValues = assignments
        .map((assignment, ordinal) => sqlDateTime(assignment.completed_at, `${record.path}.reviewers[${ordinal}].completed_at`))
        .filter(Boolean)
        .sort();
      const protocolId = await insertAndGetId(
        connection,
        `INSERT INTO protocols (
           protocol_week_id, rec_code, research_title, principal_investigator, adviser,
           course_program, document_link, status, due_date, completed_at, source_status,
           source_completed_at, source_created_at, source_updated_at, source_document_id,
           source_path, source_path_sha256, migration_run_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          weekByKey.get(`${parsed.monthId}/${parsed.weekId}`),
          requiredString(record.decoded.spup_rec_code, `${record.path}.spup_rec_code`),
          requiredString(record.decoded.research_title, `${record.path}.research_title`),
          nullableString(record.decoded.principal_investigator) ?? '',
          nullableString(record.decoded.adviser) ?? '',
          nullableString(record.decoded.course_program) ?? '',
          nullableString(record.decoded.e_link),
          isCompleted ? 'completed' : 'in_progress',
          sqlDate(record.decoded.due_date, `${record.path}.due_date`),
          isCompleted ? completionValues.at(-1) ?? null : null,
          nullableString(record.decoded.status),
          sqlDateTime(record.decoded.completed_at, `${record.path}.completed_at`),
          sqlDateTime(record.decoded.created_at, `${record.path}.created_at`),
          sqlDateTime(record.decoded.updated_at, `${record.path}.updated_at`),
          record.id,
          record.path,
          sha256Buffer(record.path),
          migrationRunId,
        ]
      );
      protocolByPath.set(record.path, protocolId);
      const assignmentNameMap = new Map();
      assignmentByProtocolAndName.set(record.path, assignmentNameMap);

      for (let ordinal = 0; ordinal < assignments.length; ordinal += 1) {
        const assignment = assignments[ordinal];
        const sourceReviewerId = requiredString(assignment.id, `${record.path}.reviewers[${ordinal}].id`);
        const sourceReviewerName = requiredString(assignment.name, `${record.path}.reviewers[${ordinal}].name`);
        const sourceFormType = nullableString(assignment.form_type);
        const formTypeCode = sourceFormType && formCodes.has(sourceFormType) ? sourceFormType : null;
        if (sourceFormType && !formTypeCode) unknownFormTypes.add(sourceFormType);
        const resolution = resolveReviewer(sourceReviewerId, sourceReviewerName);
        const assignmentId = await insertAndGetId(
          connection,
          `INSERT INTO protocol_reviewer_assignments (
             protocol_id, assignment_slot, reviewer_id, source_reviewer_id, source_reviewer_name,
             form_type_code, source_form_type, status, due_date, completed_at, source_path,
             source_path_sha256, source_ordinal, migration_run_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            protocolId,
            ordinal + 1,
            resolution.reviewerId,
            sourceReviewerId,
            sourceReviewerName,
            formTypeCode,
            sourceFormType,
            normalizedAssignmentStatuses[ordinal],
            sqlDate(assignment.due_date, `${record.path}.reviewers[${ordinal}].due_date`),
            sqlDateTime(assignment.completed_at, `${record.path}.reviewers[${ordinal}].completed_at`),
            record.path,
            sha256Buffer(record.path),
            ordinal,
            migrationRunId,
          ]
        );
        const normalizedName = normalizeReviewerName(sourceReviewerName);
        if (!assignmentNameMap.has(normalizedName)) assignmentNameMap.set(normalizedName, assignmentId);
        await connection.execute(
          `INSERT INTO reviewer_identity_resolutions (
             migration_run_id, source_path, source_path_sha256, source_ordinal,
             source_reviewer_id, source_reviewer_name, normalized_id, normalized_name,
             matched_reviewer_id, match_method, decision_note, decided_by, decided_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'deterministic-import', UTC_TIMESTAMP(6))`,
          [
            migrationRunId,
            record.path,
            sha256Buffer(record.path),
            ordinal,
            sourceReviewerId,
            sourceReviewerName,
            sourceReviewerId.trim().toLowerCase(),
            normalizedName,
            resolution.reviewerId,
            resolution.method,
            resolution.method === 'unresolved' ? 'No exact access-code or normalized canonical-name match.' : null,
          ]
        );
        if (!resolution.reviewerId) {
          unresolvedAssignments.push({
            sourcePath: record.path,
            sourceOrdinal: ordinal,
            sourceReviewerId,
            sourceReviewerName,
          });
        }
      }
    }

    let unresolvedAuditIdentities = 0;
    for (const record of [...auditRecords].sort((left, right) => left.path.localeCompare(right.path))) {
      const parsed = parseAuditPath(record.path);
      const fromName = nullableString(record.decoded.from);
      const toName = nullableString(record.decoded.to);
      const fromReviewerId = fromName ? reviewerByNormalizedName.get(normalizeReviewerName(fromName)) ?? null : null;
      const toReviewerId = toName ? reviewerByNormalizedName.get(normalizeReviewerName(toName)) ?? null : null;
      if (fromName && !fromReviewerId) unresolvedAuditIdentities += 1;
      if (toName && !toReviewerId) unresolvedAuditIdentities += 1;
      const assignmentId = toName
        ? assignmentByProtocolAndName.get(parsed.protocolPath)?.get(normalizeReviewerName(toName)) ?? null
        : null;
      await connection.execute(
        `INSERT INTO protocol_assignment_events (
           protocol_id, assignment_id, event_type, from_reviewer_id, to_reviewer_id,
           source_from_name, source_to_name, status_after, occurred_at, completed_at,
           actor_type, source_document_id, source_path, source_path_sha256, migration_run_id
         ) VALUES (?, ?, 'reassignment', ?, ?, ?, ?, ?, ?, ?, 'import', ?, ?, ?, ?)`,
        [
          protocolByPath.get(parsed.protocolPath),
          assignmentId,
          fromReviewerId,
          toReviewerId,
          fromName,
          toName,
          normalizeStatus(record.decoded.status, `${record.path}.status`),
          sqlDateTime(record.decoded.date, `${record.path}.date`),
          sqlDateTime(record.decoded.completed_at, `${record.path}.completed_at`),
          record.id,
          record.path,
          sha256Buffer(record.path),
          migrationRunId,
        ]
      );
    }

    let unresolvedNoticeLikes = 0;
    for (const record of [...noticeRecords].sort((left, right) => left.path.localeCompare(right.path))) {
      const noticeId = await insertAndGetId(
        connection,
        `INSERT INTO notices (
           title, content, priority, published_at, expires_at, source_document_id,
           source_path, source_path_sha256, migration_run_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          requiredString(record.decoded.title, `${record.path}.title`),
          requiredString(record.decoded.content, `${record.path}.content`),
          nullableString(record.decoded.priority)?.toLowerCase() ?? 'none',
          sqlDateTime(record.decoded.created_at, `${record.path}.created_at`),
          sqlDateTime(record.decoded.expires_at, `${record.path}.expires_at`),
          record.id,
          record.path,
          sha256Buffer(record.path),
          migrationRunId,
        ]
      );
      const likes = Array.isArray(record.decoded.likes) ? record.decoded.likes : [];
      for (let ordinal = 0; ordinal < likes.length; ordinal += 1) {
        const sourceReviewerId = requiredString(likes[ordinal], `${record.path}.likes[${ordinal}]`);
        const reviewerId = reviewerByAccessCode.get(sourceReviewerId)
          ?? reviewerByNormalizedName.get(normalizeReviewerName(sourceReviewerId))
          ?? null;
        if (!reviewerId) unresolvedNoticeLikes += 1;
        await connection.execute(
          `INSERT INTO notice_likes (
             notice_id, reviewer_id, source_reviewer_id, source_path, source_path_sha256,
             source_ordinal, migration_run_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [noticeId, reviewerId, sourceReviewerId, record.path, sha256Buffer(record.path), ordinal, migrationRunId]
        );
      }
    }

    const batchByLegacyId = new Map();
    for (const record of [...batchRecords].sort((left, right) => left.path.localeCompare(right.path))) {
      const data = record.decoded;
      const monthKey = nullableString(data.monthDocumentId);
      const weekKey = nullableString(data.weekId);
      const scope = requiredString(data.scope, `${record.path}.scope`).toLowerCase();
      const batchId = await insertAndGetId(
        connection,
        `INSERT INTO mail_batches (
           legacy_id, status, scope, notification_type, subject, source,
           protocol_month_id, protocol_week_id, legacy_month_key, legacy_week_key,
           period_label, reminder_date, due_soon_threshold, reviewer_count, protocol_count,
           total, pending, sending, sent, skipped, failed, last_error, started_at,
           completed_at, source_created_at, source_updated_at, source_path,
           source_path_sha256, migration_run_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          requiredString(data.status, `${record.path}.status`).toLowerCase(),
          scope,
          nullableString(data.notificationType)?.toLowerCase() ?? null,
          nullableString(data.subject) ?? '',
          requiredString(data.source, `${record.path}.source`),
          monthKey ? monthByKey.get(monthKey) ?? null : null,
          monthKey && weekKey ? weekByKey.get(`${monthKey}/${weekKey}`) ?? null : null,
          monthKey ?? '',
          weekKey ?? '',
          requiredString(data.periodLabel, `${record.path}.periodLabel`),
          sqlDate(data.reminderDate, `${record.path}.reminderDate`),
          data.dueSoonThreshold ?? null,
          Number(data.reviewerCount ?? 0),
          Number(data.protocolCount ?? 0),
          Number(data.total ?? 0),
          Number(data.pending ?? 0),
          Number(data.sending ?? 0),
          Number(data.sent ?? 0),
          Number(data.skipped ?? 0),
          Number(data.failed ?? 0),
          nullableString(data.lastError),
          sqlDateTime(data.startedAt, `${record.path}.startedAt`),
          sqlDateTime(data.completedAt, `${record.path}.completedAt`),
          sqlDateTime(data.createdAt, `${record.path}.createdAt`),
          sqlDateTime(data.updatedAt, `${record.path}.updatedAt`),
          record.path,
          sha256Buffer(record.path),
          migrationRunId,
        ]
      );
      batchByLegacyId.set(record.id, batchId);
    }

    for (const record of [...deliveryRecords].sort((left, right) => left.path.localeCompare(right.path))) {
      const data = record.decoded;
      const reviewerId = reviewerByAccessCode.get(data.reviewerId)
        ?? reviewerByNormalizedName.get(normalizeReviewerName(data.reviewerName))
        ?? reviewerByEmail.get(String(data.email ?? '').trim().toLowerCase())
        ?? null;
      await connection.execute(
        `INSERT INTO mail_deliveries (
           mail_batch_id, legacy_id, reviewer_id, requested_reviewer_id, recipient_name,
           recipient_email, email_match_source, status, subject, protocol_count, attempts,
           max_attempts, external_message_id, reason, last_error, sending_at, last_attempt_at,
           sent_at, skipped_at, failed_at, source_created_at, source_updated_at, source_path,
           source_path_sha256, migration_run_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          batchByLegacyId.get(data.batchId),
          record.id,
          reviewerId,
          requiredString(data.requestedReviewerId, `${record.path}.requestedReviewerId`),
          requiredString(data.reviewerName, `${record.path}.reviewerName`),
          nullableString(data.email) ?? '',
          nullableString(data.emailMatchSource)?.toLowerCase() ?? null,
          requiredString(data.status, `${record.path}.status`).toLowerCase(),
          nullableString(data.subject) ?? '',
          Number(data.protocolCount ?? 0),
          Number(data.attempts ?? 0),
          Number(data.maxAttempts ?? 3),
          nullableString(data.messageId),
          nullableString(data.reason),
          nullableString(data.lastError),
          sqlDateTime(data.sendingAt, `${record.path}.sendingAt`),
          sqlDateTime(data.lastAttemptAt, `${record.path}.lastAttemptAt`),
          sqlDateTime(data.sentAt, `${record.path}.sentAt`),
          sqlDateTime(data.skippedAt, `${record.path}.skippedAt`),
          sqlDateTime(data.failedAt, `${record.path}.failedAt`),
          sqlDateTime(data.createdAt, `${record.path}.createdAt`),
          sqlDateTime(data.updatedAt, `${record.path}.updatedAt`),
          record.path,
          sha256Buffer(record.path),
          migrationRunId,
        ]
      );
    }

    const warningCount = unresolvedAssignments.length + unresolvedAuditIdentities + unresolvedNoticeLikes + unknownFormTypes.size;
    await connection.execute(
      `UPDATE migration_runs
          SET status = 'validated', import_completed_at = UTC_TIMESTAMP(6),
              imported_document_count = ?, warning_count = ?, error_count = 0,
              notes = ?
        WHERE id = ?`,
      [
        records.length,
        warningCount,
        `Deterministic import. Unresolved assignments=${unresolvedAssignments.length}; audit identities=${unresolvedAuditIdentities}; notice likes=${unresolvedNoticeLikes}; unknown form types=${unknownFormTypes.size}.`,
        migrationRunId,
      ]
    );

    await connection.commit();
    return {
      alreadyImported: false,
      report: {
        status: 'validated',
        snapshot: snapshot.snapshotName,
        manifestSha256: snapshot.manifestSha256,
        migrationRunId,
        importedCounts: {
          rawDocuments: records.length,
          protocols: protocolRecords.length,
          assignments: assignmentCount,
          reviewers: reviewerRecords.length,
          audits: auditRecords.length,
          mailBatches: batchRecords.length,
          mailDeliveries: deliveryRecords.length,
          notices: noticeRecords.length,
          noticeLikes: noticeLikeCount,
        },
        unresolvedAssignments,
        unresolvedAuditIdentityValues: unresolvedAuditIdentities,
        unresolvedNoticeLikes,
        unknownFormTypes: [...unknownFormTypes].sort(),
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

async function main() {
  const requestedSnapshot = process.argv[2];
  const snapshot = await loadVerifiedSnapshot(requestedSnapshot);
  console.log(`Verified portable snapshot before database access: ${snapshot.backupDirectory}`);
  console.log(`Documents: ${snapshot.records.length}; manifest SHA-256: ${snapshot.manifestSha256}`);

  const connection = await openConnection();
  try {
    const result = await importSnapshot(connection, snapshot);
    const reportPath = await writeReport(snapshot.snapshotName, result.report);
    console.log(result.alreadyImported ? 'Snapshot was already imported; no rows were changed.' : 'MySQL import committed.');
    console.log(`Import report: ${reportPath}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('Portable Firestore to MySQL import failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
