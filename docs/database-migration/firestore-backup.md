# Firestore backup before MySQL migration

This project will use a one-time Firestore-to-MySQL migration. Firebase must not be deleted until both backup forms, the local MySQL import, application acceptance tests, and a restore drill have passed.

## Backup forms

Create both backups during the final write-freeze window:

1. **Portable NDJSON backup** for inspection, reconciliation, and MySQL transformation.
2. **Native managed Firestore export** for disaster recovery. This format is not JSON and its downloaded file tree must not be renamed or modified.

All local output is written under `backups/`, which is ignored by Git.

## Portable backup

The verified portable snapshot has already been created and is retained under the Git-ignored `backups/firestore/portable/` directory. The Firebase exporter and runtime configuration were removed after the successful MySQL import. Verification remains available:

```powershell
npm run backup:firestore:verify
```

To verify a specific snapshot instead of the newest snapshot:

```powershell
npm run backup:firestore:verify -- backups/firestore/portable/YOUR_TIMESTAMP
```

The manifest records the project, source Git commit, document counts, limitations, file names, and SHA-256 checksums. Firestore values are retained with explicit type tags in NDJSON. The completed snapshot covers every collection and collection group referenced by the former Firebase application:

- `protocols/{monthId}/{weekId}/{protocolId}`
- legacy `protocols/{protocolId}`
- protocol `audits` subcollections
- `reviewers`
- `notices`
- `system_notices`
- `system`
- `mail_batches`
- `mail_logs`

Because the browser Firestore SDK cannot enumerate unknown collection IDs, the native export remains the authoritative complete backup.

## Native managed export prerequisites

Managed export/import requires billing to be enabled for the Firebase project. The signed-in Google account needs sufficient Firestore import/export and Cloud Storage permissions. Project Owner is sufficient; the narrower documented roles are `roles/datastore.importExportAdmin` and `roles/storage.admin`.

Install the [Google Cloud CLI for Windows](https://cloud.google.com/sdk/docs/install-sdk#windows), open a new PowerShell window, and sign in with the Google account that owns or administers the Firebase project:

```powershell
gcloud auth login
gcloud auth list
```

This opens a browser login. Do not download or paste a service-account private key for this one-time workflow.

Confirm the project and database before creating anything:

```powershell
$ProjectId = "rec-reviews-cdbaa"
gcloud projects describe "$ProjectId"
gcloud billing projects describe "$ProjectId"
gcloud firestore databases describe --database="(default)" --project="$ProjectId"
```

The backup bucket must be near the Firestore database location. A regional Firestore location can use a bucket in the same region. For multi-region databases such as `nam5`, `nam7`, or `eur3`, choose a nearby supported Cloud Storage location rather than passing the Firestore multi-region code blindly. Bucket names are globally unique.

The current default Firestore database is in `asia-east2`. Billing was enabled and the initial native managed export completed successfully on August 11, 2026.

Official references:

- [Firestore managed export and import](https://firebase.google.com/docs/firestore/manage-data/export-import)
- [Firestore locations](https://firebase.google.com/docs/firestore/locations)
- [Cloud Storage bucket locations](https://cloud.google.com/storage/docs/bucket-locations)
- [Google Cloud CLI authentication](https://cloud.google.com/sdk/gcloud/reference/auth/login)

## Run the native export

Choose a globally unique bucket name. The script verifies the project and database, optionally creates a private Standard bucket, exports the entire default database, downloads the untouched export tree, checks for the required metadata file, and writes local SHA-256 hashes.

```powershell
.\scripts\backup-firestore-managed.ps1 `
  -ProjectId "rec-reviews-cdbaa" `
  -BucketName "YOUR-GLOBALLY-UNIQUE-BUCKET" `
  -BucketLocation "asia-east2" `
  -CreateBucket
```

After the script completes, independently verify the downloaded native tree, file sizes, SHA-256 hashes, metadata file, and successful Firestore operation:

```powershell
npm run backup:firestore:verify-managed
```

On later runs, omit `-CreateBucket` to reuse the existing bucket.

The script intentionally omits `--collection-ids`, so the managed export includes the entire database and nested collections. It leaves the cloud copy in place and also stores the downloaded copy under `backups/firestore/managed/`.

## Final cutover backup checklist

The initial portable snapshot is a safety backup, not the final cutover snapshot. For the one-time migration:

1. Put the application into a maintenance/read-only window so no Firestore writes occur.
2. Run the native managed export and wait for successful completion.
3. Produce and verify a fresh portable snapshot while writes remain frozen. The retired exporter must be recovered from the migration commit or replaced with an equivalent read-only extractor for this final snapshot.
4. Compare collection counts and reviewer/protocol relationships against the MySQL import.
5. Run the application locally using only MySQL and complete acceptance testing.
6. Perform a Firestore restore drill before authorizing deletion.
7. Retain the downloaded native tree and portable export in a second encrypted location before deleting the Firebase/Google Cloud project.

Important native-restore constraints:

- Managed import reads from Cloud Storage, not directly from the local filesystem.
- The export does not include Firestore index definitions.
- Existing documents with matching IDs are overwritten; unrelated documents are not removed.
- A partial or cancelled export cannot be imported.
- The `*.overall_export_metadata` file and its parent directory naming must remain unchanged.
- Deleting the Google Cloud project also deletes buckets in that project, so a verified independent copy is mandatory first.
