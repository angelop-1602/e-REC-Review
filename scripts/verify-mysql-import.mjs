import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import mysql from 'mysql2/promise';

const BACKUP_ROOT = path.resolve(process.cwd(), 'backups', 'firestore', 'portable');
const REPORT_ROOT = path.resolve(process.cwd(), 'backups', 'mysql', 'reports');
const EXPECTED = Object.freeze({
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

const hashHex = (value) => createHash('sha256').update(value).digest('hex');

async function hashFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function latestSnapshotDirectory() {
  const entries = await readdir(BACKUP_ROOT, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory() && !entry.name.endsWith('.incomplete'))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));
  if (!names.length) throw new Error(`No portable snapshot found under ${BACKUP_ROOT}.`);
  return path.join(BACKUP_ROOT, names[0]);
}

function dataFilePath(dataDirectory, fileName) {
  if (typeof fileName !== 'string' || path.basename(fileName) !== fileName || !fileName.endsWith('.ndjson')) {
    throw new Error(`Unsafe manifest filename: ${String(fileName)}`);
  }
  return path.resolve(dataDirectory, fileName);
}

async function loadAndVerifySnapshot(requestedDirectory) {
  const directory = requestedDirectory ? path.resolve(process.cwd(), requestedDirectory) : await latestSnapshotDirectory();
  const manifestBytes = await readFile(path.join(directory, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.format !== 'e-rec-portable-firestore-backup' || manifest.formatVersion !== 1 || manifest.status !== 'complete') {
    throw new Error('Portable snapshot manifest is incomplete or unsupported.');
  }
  const records = [];
  const seenPaths = new Set();
  for (const source of manifest.sources ?? []) {
    const filePath = dataFilePath(path.join(directory, 'data'), source.file);
    const actualHash = await hashFile(filePath);
    if (actualHash !== source.sha256) throw new Error(`Snapshot checksum mismatch for ${source.file}.`);
    const text = await readFile(filePath, 'utf8');
    const rows = text.split(/\r?\n/).filter((line) => line.trim()).map((line) => ({ ...JSON.parse(line), rawJson: line }));
    if (rows.length !== source.count) throw new Error(`Snapshot count mismatch for ${source.file}.`);
    for (const row of rows) {
      if (seenPaths.has(row.path)) throw new Error(`Duplicate source path in snapshot: ${row.path}`);
      seenPaths.add(row.path);
      records.push(row);
    }
  }
  if (records.length !== manifest.totalDocuments) throw new Error('Snapshot manifest total does not match parsed records.');
  return {
    directory,
    label: path.basename(directory),
    manifest,
    manifestSha256: hashHex(manifestBytes),
    records,
  };
}

function unwrap(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(unwrap);
  if (value.__firestoreType === 'map') {
    return Object.fromEntries(Object.entries(value.value ?? {}).map(([key, item]) => [key, unwrap(item)]));
  }
  if (value.__firestoreType === 'array') return (value.value ?? []).map(unwrap);
  if (value.__firestoreType === 'timestamp') return { kind: 'timestamp', iso: value.iso };
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unwrap(item)]));
}

function normalizeName(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function mysqlConfiguration() {
  const uri = process.env.MYSQL_URL || (process.env.DATABASE_URL?.startsWith('mysql') ? process.env.DATABASE_URL : null);
  if (uri) return uri;
  if (!process.env.MYSQL_DATABASE) throw new Error('Set MYSQL_URL or MYSQL_DATABASE before verification.');
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE,
    timezone: 'Z',
    decimalNumbers: true,
  };
}

async function openConnection() {
  const connection = await mysql.createConnection(mysqlConfiguration());
  await connection.query("SET time_zone = '+00:00'");
  return connection;
}

async function scalar(connection, sql, values = []) {
  const [rows] = await connection.execute(sql, values);
  return Number(Object.values(rows[0])[0]);
}

function makeChecks() {
  const checks = [];
  return {
    assert(name, condition, evidence) {
      checks.push({ name, passed: Boolean(condition), evidence });
    },
    checks,
  };
}

async function verifyDatabase(connection, snapshot) {
  const { assert, checks } = makeChecks();
  const manifest = snapshot.manifest;
  const projectId = manifest.source?.firebaseProjectId;
  const databaseId = manifest.source?.databaseId;
  const decoded = snapshot.records.map((record) => ({ ...record, decoded: unwrap(record.data) }));
  const protocols = decoded.filter((record) => /^week-[1-5]$/.test(record.source.name));
  const reviewers = decoded.filter((record) => record.source.name === 'reviewers');
  const audits = decoded.filter((record) => record.source.name === 'audits');
  const batches = decoded.filter((record) => record.source.name === 'mail_batches');
  const deliveries = decoded.filter((record) => record.source.name === 'mail_logs');
  const notices = decoded.filter((record) => record.source.name === 'notices');
  const assignmentCount = protocols.reduce((count, record) => count + (record.decoded.reviewers?.length ?? 0), 0);
  const likeCount = notices.reduce((count, record) => count + (record.decoded.likes?.length ?? 0), 0);
  const snapshotCounts = {
    rawDocuments: decoded.length,
    protocols: protocols.length,
    assignments: assignmentCount,
    reviewers: reviewers.length,
    audits: audits.length,
    mailBatches: batches.length,
    mailDeliveries: deliveries.length,
    notices: notices.length,
    noticeLikes: likeCount,
  };
  for (const [key, expected] of Object.entries(EXPECTED)) {
    assert(`snapshot_count_${key}`, snapshotCounts[key] === expected, { expected, actual: snapshotCounts[key] });
  }

  const [runRows] = await connection.execute(
    `SELECT id, status, manifest_sha256, source_document_count, imported_document_count,
            warning_count, error_count
       FROM migration_runs
      WHERE source_project_id = ? AND source_database_id = ? AND snapshot_label = ?`,
    [projectId, databaseId, snapshot.label]
  );
  assert('one_migration_run', runRows.length === 1, { actual: runRows.length });
  if (runRows.length !== 1) return { checks, migrationRunId: null, snapshotCounts };
  const run = runRows[0];
  const migrationRunId = Number(run.id);
  const storedManifestHash = Buffer.isBuffer(run.manifest_sha256)
    ? run.manifest_sha256.toString('hex')
    : String(run.manifest_sha256);
  assert('migration_run_validated', run.status === 'validated', { actual: run.status });
  assert('manifest_hash_matches', storedManifestHash === snapshot.manifestSha256, {
    expected: snapshot.manifestSha256,
    actual: storedManifestHash,
  });
  assert('migration_run_document_counts',
    Number(run.source_document_count) === EXPECTED.rawDocuments && Number(run.imported_document_count) === EXPECTED.rawDocuments,
    { source: Number(run.source_document_count), imported: Number(run.imported_document_count) }
  );
  assert('migration_run_has_no_errors', Number(run.error_count) === 0, { actual: Number(run.error_count) });

  const [rawRows] = await connection.execute(
    `SELECT source_path, HEX(source_path_sha256) AS path_hash, source_document_id,
            parent_path, source_kind, source_name, HEX(payload_sha256) AS payload_hash
       FROM firestore_documents WHERE migration_run_id = ?`,
    [migrationRunId]
  );
  const rawByPath = new Map(rawRows.map((row) => [row.source_path, row]));
  let rawMismatches = 0;
  for (const record of decoded) {
    const stored = rawByPath.get(record.path);
    const expectedPayload = JSON.stringify(record.data);
    if (!stored
      || stored.path_hash.toLowerCase() !== hashHex(record.path)
      || stored.payload_hash.toLowerCase() !== hashHex(expectedPayload)
      || stored.source_document_id !== record.id
      || stored.parent_path !== record.parentPath
      || stored.source_kind !== record.source.kind
      || stored.source_name !== record.source.name) {
      rawMismatches += 1;
    }
  }
  assert('raw_archive_exact_lineage_and_hashes', rawRows.length === EXPECTED.rawDocuments && rawMismatches === 0, {
    rows: rawRows.length,
    mismatches: rawMismatches,
  });

  const tableCountQueries = {
    reviewers: 'SELECT COUNT(*) AS count FROM reviewers WHERE migration_run_id = ?',
    protocols: 'SELECT COUNT(*) AS count FROM protocols WHERE migration_run_id = ?',
    assignments: 'SELECT COUNT(*) AS count FROM protocol_reviewer_assignments WHERE migration_run_id = ?',
    identityResolutions: 'SELECT COUNT(*) AS count FROM reviewer_identity_resolutions WHERE migration_run_id = ?',
    audits: 'SELECT COUNT(*) AS count FROM protocol_assignment_events WHERE migration_run_id = ?',
    mailBatches: 'SELECT COUNT(*) AS count FROM mail_batches WHERE migration_run_id = ?',
    mailDeliveries: 'SELECT COUNT(*) AS count FROM mail_deliveries WHERE migration_run_id = ?',
    notices: 'SELECT COUNT(*) AS count FROM notices WHERE migration_run_id = ?',
    noticeLikes: 'SELECT COUNT(*) AS count FROM notice_likes WHERE migration_run_id = ?',
  };
  const databaseCounts = {};
  for (const [key, sql] of Object.entries(tableCountQueries)) databaseCounts[key] = await scalar(connection, sql, [migrationRunId]);
  for (const key of ['reviewers', 'protocols', 'assignments', 'audits', 'mailBatches', 'mailDeliveries', 'notices', 'noticeLikes']) {
    assert(`database_count_${key}`, databaseCounts[key] === EXPECTED[key], { expected: EXPECTED[key], actual: databaseCounts[key] });
  }
  assert('one_resolution_per_assignment', databaseCounts.identityResolutions === EXPECTED.assignments, {
    expected: EXPECTED.assignments,
    actual: databaseCounts.identityResolutions,
  });

  const [reviewerRows] = await connection.execute(
    'SELECT id, access_code, full_name FROM reviewers WHERE migration_run_id = ?',
    [migrationRunId]
  );
  const reviewerByAccess = new Map(reviewerRows.map((row) => [row.access_code, row]));
  const reviewerByName = new Map(reviewerRows.map((row) => [normalizeName(row.full_name), row]));
  const expectedResolutions = new Map();
  for (const protocol of protocols) {
    for (let ordinal = 0; ordinal < protocol.decoded.reviewers.length; ordinal += 1) {
      const source = protocol.decoded.reviewers[ordinal];
      const byAccess = reviewerByAccess.get(source.id);
      const byName = reviewerByName.get(normalizeName(source.name));
      expectedResolutions.set(`${protocol.path}\u0000${ordinal}`, byAccess
        ? { method: 'exact_access_code', reviewerId: Number(byAccess.id) }
        : byName
          ? { method: 'exact_canonical_name', reviewerId: Number(byName.id) }
          : { method: 'unresolved', reviewerId: null });
    }
  }
  const [resolutionRows] = await connection.execute(
    `SELECT source_path, source_ordinal, matched_reviewer_id, match_method
       FROM reviewer_identity_resolutions WHERE migration_run_id = ?`,
    [migrationRunId]
  );
  let resolutionMismatches = 0;
  for (const row of resolutionRows) {
    const expected = expectedResolutions.get(`${row.source_path}\u0000${row.source_ordinal}`);
    const actualReviewerId = row.matched_reviewer_id === null ? null : Number(row.matched_reviewer_id);
    if (!expected || expected.method !== row.match_method || expected.reviewerId !== actualReviewerId) resolutionMismatches += 1;
  }
  const unresolvedExpected = [...expectedResolutions.values()].filter((value) => value.method === 'unresolved').length;
  const unresolvedActual = resolutionRows.filter((row) => row.match_method === 'unresolved').length;
  assert('deterministic_reviewer_resolutions', resolutionMismatches === 0 && unresolvedActual === unresolvedExpected, {
    mismatches: resolutionMismatches,
    unresolvedExpected,
    unresolvedActual,
  });
  assert('known_unresolved_assignment_count', unresolvedActual === 42, { expected: 42, actual: unresolvedActual });

  const assignmentResolutionMismatch = await scalar(
    connection,
    `SELECT COUNT(*) AS count
       FROM protocol_reviewer_assignments a
       LEFT JOIN reviewer_identity_resolutions r
         ON r.migration_run_id = a.migration_run_id
        AND r.source_path_sha256 = a.source_path_sha256
        AND r.source_ordinal = a.source_ordinal
      WHERE a.migration_run_id = ?
        AND (r.id IS NULL OR NOT (a.reviewer_id <=> r.matched_reviewer_id))`,
    [migrationRunId]
  );
  assert('assignment_resolution_fk_consistency', assignmentResolutionMismatch === 0, { actual: assignmentResolutionMismatch });

  const derivedCompletionMismatch = await scalar(
    connection,
    `SELECT COUNT(*) AS count FROM (
       SELECT p.id
         FROM protocols p
         LEFT JOIN protocol_reviewer_assignments a ON a.protocol_id = p.id AND a.deleted_at IS NULL
        WHERE p.migration_run_id = ?
        GROUP BY p.id, p.status, p.completed_at
       HAVING p.status <> CASE
                WHEN COUNT(a.id) > 0 AND SUM(a.status = 'completed') = COUNT(a.id) THEN 'completed'
                ELSE 'in_progress'
              END
          OR NOT (p.completed_at <=> CASE
                WHEN COUNT(a.id) > 0 AND SUM(a.status = 'completed') = COUNT(a.id) THEN MAX(a.completed_at)
                ELSE NULL
              END)
     ) AS mismatches`,
    [migrationRunId]
  );
  assert('protocol_completion_derived_from_assignments', derivedCompletionMismatch === 0, { actual: derivedCompletionMismatch });

  const completedAssignments = await scalar(
    connection,
    `SELECT COUNT(*) AS count FROM protocol_reviewer_assignments
      WHERE migration_run_id = ? AND status = 'completed' AND completed_at IS NOT NULL`,
    [migrationRunId]
  );
  const inProgressAssignments = await scalar(
    connection,
    `SELECT COUNT(*) AS count FROM protocol_reviewer_assignments
      WHERE migration_run_id = ? AND status = 'in_progress' AND completed_at IS NULL`,
    [migrationRunId]
  );
  assert('assignment_status_timestamp_distribution', completedAssignments === 1575 && inProgressAssignments === 304, {
    completedAssignments,
    inProgressAssignments,
  });

  const auditParentMismatch = await scalar(
    connection,
    `SELECT COUNT(*) AS count
       FROM protocol_assignment_events e
       JOIN protocols p ON p.id = e.protocol_id
      WHERE e.migration_run_id = ?
        AND LEFT(e.source_path, LENGTH(e.source_path) - LENGTH(SUBSTRING_INDEX(e.source_path, '/audits/', -1)) - 8) <> p.source_path`,
    [migrationRunId]
  );
  assert('audit_parent_integrity', auditParentMismatch === 0, { actual: auditParentMismatch });

  const deliveryParentMismatch = await scalar(
    connection,
    `SELECT COUNT(*) AS count
       FROM mail_deliveries d
       LEFT JOIN mail_batches b ON b.id = d.mail_batch_id
      WHERE d.migration_run_id = ? AND (b.id IS NULL OR b.migration_run_id <> d.migration_run_id)`,
    [migrationRunId]
  );
  assert('mail_delivery_parent_integrity', deliveryParentMismatch === 0, { actual: deliveryParentMismatch });

  const batchReconciliationMismatch = await scalar(
    connection,
    `SELECT COUNT(*) AS count FROM (
       SELECT b.id
         FROM mail_batches b
         LEFT JOIN mail_deliveries d ON d.mail_batch_id = b.id
        WHERE b.migration_run_id = ?
        GROUP BY b.id, b.total, b.pending, b.sending, b.sent, b.skipped, b.failed
       HAVING b.total <> COUNT(d.id)
          OR b.pending <> SUM(d.status = 'pending')
          OR b.sending <> SUM(d.status = 'sending')
          OR b.sent <> SUM(d.status = 'sent')
          OR b.skipped <> SUM(d.status = 'skipped')
          OR b.failed <> SUM(d.status = 'failed')
     ) AS mismatches`,
    [migrationRunId]
  );
  assert('mail_batch_reconciliation', batchReconciliationMismatch === 0, { actual: batchReconciliationMismatch });

  const unresolvedNoticeLikes = await scalar(
    connection,
    'SELECT COUNT(*) AS count FROM notice_likes WHERE migration_run_id = ? AND reviewer_id IS NULL',
    [migrationRunId]
  );
  const expectedUnresolvedNoticeLikes = notices
    .flatMap((notice) => notice.decoded.likes ?? [])
    .filter((sourceReviewerId) => !reviewerByAccess.has(sourceReviewerId)
      && !reviewerByName.has(normalizeName(sourceReviewerId)))
    .length;
  assert('notice_like_history_preserved', unresolvedNoticeLikes === expectedUnresolvedNoticeLikes, {
    expectedUnresolved: expectedUnresolvedNoticeLikes,
    actual: unresolvedNoticeLikes,
  });

  const unresolvedMailReviewers = await scalar(
    connection,
    'SELECT COUNT(*) AS count FROM mail_deliveries WHERE migration_run_id = ? AND reviewer_id IS NULL',
    [migrationRunId]
  );
  assert('mail_reviewers_resolved', unresolvedMailReviewers === 0, { actual: unresolvedMailReviewers });

  return { checks, migrationRunId, snapshotCounts, databaseCounts, warningCount: Number(run.warning_count) };
}

async function writeReport(snapshot, verification) {
  await mkdir(REPORT_ROOT, { recursive: true });
  const reportPath = path.join(REPORT_ROOT, `${snapshot.label}-verify.json`);
  const failedChecks = verification.checks.filter((check) => !check.passed);
  const report = {
    status: failedChecks.length ? 'failed' : 'passed',
    snapshot: snapshot.label,
    manifestSha256: snapshot.manifestSha256,
    migrationRunId: verification.migrationRunId,
    snapshotCounts: verification.snapshotCounts,
    databaseCounts: verification.databaseCounts,
    warningCount: verification.warningCount,
    checks: verification.checks,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { reportPath, failedChecks };
}

async function main() {
  const snapshot = await loadAndVerifySnapshot(process.argv[2]);
  console.log(`Portable snapshot checksums verified: ${snapshot.directory}`);
  const connection = await openConnection();
  try {
    const verification = await verifyDatabase(connection, snapshot);
    const { reportPath, failedChecks } = await writeReport(snapshot, verification);
    if (failedChecks.length) {
      throw new Error(`${failedChecks.length} MySQL verification check(s) failed. See ${reportPath}.`);
    }
    console.log(`MySQL import verification passed (${verification.checks.length} checks).`);
    console.log(`Verification report: ${reportPath}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('MySQL import verification failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
