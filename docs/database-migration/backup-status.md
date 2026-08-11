# Verified Firestore backup status

Status recorded on August 11, 2026.

## Portable backup

- Local directory: `backups/firestore/portable/2026-08-11T01-47-21-961Z`
- Status: complete and independently verified
- Project: `rec-reviews-cdbaa`
- Database: `(default)`
- Documents: 746 unique paths
- Source queries: 13
- Verification: every NDJSON file parsed, record counts matched, document paths were unique, and every SHA-256 checksum matched

Document counts:

| Source | Documents |
|---|---:|
| Canonical nested protocols, week 1 | 149 |
| Canonical nested protocols, week 2 | 161 |
| Canonical nested protocols, week 3 | 150 |
| Canonical nested protocols, week 4 | 182 |
| Canonical nested protocols, week 5 | 0 |
| Legacy flat protocols | 0 |
| Protocol audit records | 4 |
| Reviewers | 34 |
| Notices | 1 |
| Mail batches | 5 |
| Mail logs | 60 |
| System settings/notices | 0 |

## Native managed export

- Local directory: `backups/firestore/managed/20260811T020137Z`
- Cloud URI: `gs://rec-reviews-cdbaa-firestore-backup-199706126174/managed/firestore-20260811T020137Z`
- Firestore location: `asia-east2`
- Operation state: successful
- Documents completed: 746
- Downloaded native files: 9
- Downloaded bytes: 876,988
- Required `*.overall_export_metadata` file: present
- Verification: every downloaded file size and SHA-256 checksum matched the manifest, no untracked native files were present, and the successful Firestore operation matched the manifest output URI
- Bucket controls: uniform bucket-level access enabled and public access prevention enforced

## Reconciliation result

The portable backup and native managed export independently report 746 documents. This is the verified baseline for MySQL schema profiling and import development.

## Local MySQL import

- MySQL version: 8.4.11
- Local binding: `127.0.0.1:3307` on this workstation because port 3306 is already used by another project
- Schema tables: 21
- Migration run status: validated
- Independent verification: 34 of 34 checks passed
- Raw Firestore documents with matching lineage and payload hashes: 746
- Protocols: 642
- Reviewer assignments and identity decisions: 1,879
- Reviewers: 34
- Audit events: 4
- Mail batches/deliveries: 5 / 60
- Notices/likes: 1 / 2
- Assignment statuses: 1,575 completed and 304 in progress
- Unresolved reviewer assignments retained for manual mapping: 42
- Import idempotency: verified; rerunning the same snapshot changed no rows
- Verified local SQL dump: `backups/mysql/erec-review-20260811-local-verified.sql` (2,901,082 bytes; SHA-256 `E2C85D3BEE3E3113AF517515DCB03C79113DA30E59415F6F5390AFEE754AEF65`)
- Restore drill: the dump was restored into the separate `erec_review_restore_20260811` database and passed the same 34 reconciliation checks

## MySQL application runtime

- The application now reads and writes through server-side MySQL repositories and API routes.
- Reviewer login keeps the existing reviewer code/name flow; no password or one-time-code system was added.
- Admin protocol CRUD, uploads, reviewer profiles, reassignment audits, notices, settings, exports, mail history, review status updates, and scheduled reminders now use MySQL.
- Reminder delivery only selects incomplete reviewer assignments within the configured due-date window, and reminder emails use the subject `Reminder`.
- Firebase SDK packages, runtime initialization modules, rules, and obsolete Firebase maintenance scripts have been removed.
- Historical backup, verification, and one-time import artifacts are retained so the migration remains auditable and repeatable.
- The source Firestore database and its cloud backup have not been deleted. Destruction remains a separate, explicitly approved cutover step.

The local application acceptance gate is complete. Server deployment documentation and the final write-freeze/cutover backup remain pending.

These are safety/development snapshots. Both backups must be repeated during the final maintenance/write-freeze window before production cutover.
