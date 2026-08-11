# Firestore to MySQL 8 migration plan

## Confirmed decisions

- Back up the complete Firestore database, including operational history.
- Firebase Authentication, Storage, and other Firebase services are not used.
- Retain protocols, reviewer assignments, reviewer records, audits, notices, settings, mail batches, and mail logs.
- Use MySQL 8.0 or newer.
- Test the migration against local MySQL first.
- Perform a one-time cutover rather than a permanent dual-write period.
- Remove all Firebase code, packages, configuration, environment variables, and data only after MySQL validation and an explicit destruction approval.
- Document server installation and deployment after local acceptance testing.

## Firestore data boundary

The migration must preserve:

- Canonical protocols at `protocols/{monthId}/{weekId}/{protocolId}`.
- Legacy flat protocol documents at `protocols/{protocolId}`, if any exist.
- Reassignment audits below protocol documents.
- Embedded reviewer assignments, including their form type, status, reviewer-specific due date, and completion timestamp.
- Reviewers and optional email addresses.
- Notices and reviewer likes.
- System notices.
- Notification settings.
- Mail batches and individual delivery logs.

Source timestamps are inconsistent: some are Firestore timestamps, some are ISO strings, and some are absent or null. The portable backup retains source-type tags; normalization belongs in the MySQL import layer, not the extraction layer.

## Migration gates

### 1. Backup gate

- Produce and verify portable NDJSON.
- Produce and download a native managed Firestore export.
- Retain manifests, source project/database identifiers, counts, and checksums.
- Repeat both backups during the final write-freeze window.

### 2. MySQL schema and import gate

- Design normalized MySQL tables after profiling the verified portable snapshot.
- Preserve original Firestore document paths/IDs as migration lineage columns.
- Import into a new local MySQL 8 database.
- Reject or report malformed timestamps, duplicate paths, missing reviewer references, and invalid audit parents; do not silently repair source data.
- Reconcile counts and review-completion totals with the backup manifest.

### 3. Application replacement gate

- Add server-only MySQL connectivity. Never expose MySQL credentials to browser code.
- Replace direct browser Firestore access with application API routes/server data services.
- Preserve transactions for review completion, reviewer reassignment plus audit creation, protocol moves, and mail status counters.
- Replace real-time Firestore mail-history listeners with deliberate polling or another server-backed update mechanism.
- Validate reviewer access, protocol CRUD and uploads, status changes, reviewer management/profile email actions, notices/likes, exports, mailing logs, and automatic reminders.

### 4. Local acceptance gate

- Run the application with Firebase access disabled and only local MySQL enabled.
- Confirm there are no Firebase runtime imports outside migration/backup tooling.
- Run type checks, lint, production build, migration reconciliation, and end-to-end smoke tests.
- Exercise a MySQL backup and restore locally.

### 5. Server deployment and cutover gate

- Document MySQL server creation, least-privilege database user setup, TLS/network restrictions, backups, environment variables, migrations, application deployment, and rollback.
- Enter a maintenance/write-freeze window.
- Create and verify final native and portable Firestore backups.
- Import the final snapshot, deploy the MySQL-backed application, and run production smoke tests.
- Keep Firestore intact but read-only during the agreed rollback period.

### 6. Firebase destruction gate

Firebase deletion is a separate destructive operation and requires explicit confirmation after every previous gate passes. Before deletion:

- Store verified native and portable backups in at least two independent locations, with one encrypted copy outside the Firebase Google Cloud project.
- Complete a restore drill.
- Confirm record and relationship reconciliation.
- Confirm the deployed application has zero Firebase runtime dependencies.
- Remove Firebase variables, browser/server initialization modules, package dependencies, rules, obsolete scripts, and documentation.

Do not delete the Google Cloud project merely to delete Firestore without checking for unrelated resources. Project deletion also removes Cloud Storage buckets stored in that project.

## Preserved access behavior

By explicit project decision, this migration preserves the existing reviewer code/name login and the current admin access behavior. Passwords, one-time codes, replacement reviewer codes, and a new authentication system are outside this migration's scope. MySQL credentials remain server-only and browser writes now pass through application API routes, but those routes do not add a new user-authentication boundary.

This is a known security limitation to revisit separately before exposing the deployment to an untrusted network. It must not be silently represented as authenticated access in deployment documentation.
