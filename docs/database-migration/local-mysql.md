# Local MySQL 8.4 on Windows

This is the reproducible local database used to develop and validate the one-time Firestore migration. It runs MySQL `8.4.11` in Docker Desktop, listens only on `127.0.0.1`, stores database files in a named Docker volume, and writes manual SQL backups under the Git-ignored `backups/mysql/` directory.

Do not use these local credentials on the eventual server. Server provisioning, TLS, network policy, and production secret storage are separate cutover tasks.

## Prerequisites

- Docker Desktop with the WSL 2 Linux engine.
- PowerShell opened in the repository root.
- Enough local disk space for the database volume and at least two SQL dumps.

Start Docker Desktop if it is not already running:

```powershell
& 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
```

Wait until Docker Desktop reports that its Linux engine is running, then verify both the client and server are available:

```powershell
docker version --format 'client={{.Client.Version}} server={{.Server.Version}}'
docker compose version
```

If `docker version` reports that it cannot connect to `dockerDesktopLinuxEngine`, Docker Desktop has not finished starting.

## Create local credentials

The Compose file requires two different passwords:

- `MYSQL_ROOT_PASSWORD` is for local database administration and backup/restore work.
- `MYSQL_PASSWORD` belongs to the lower-privilege application user named by `MYSQL_USER`.

Use the single ignored `.env.local` for MySQL, mail, application, and reminder settings. Start from the tracked example, then generate the two database passwords without printing them:

```powershell
Copy-Item .env.example .env.local

$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rootBytes = New-Object byte[] 48
$appBytes = New-Object byte[] 48

try {
  $rng.GetBytes($rootBytes)
  $rng.GetBytes($appBytes)
  $mysqlRootSecret = [Convert]::ToBase64String($rootBytes)
  $mysqlAppSecret = [Convert]::ToBase64String($appBytes)

  $envText = Get-Content -LiteralPath .env.local -Raw
  $envText = $envText -replace '(?m)^MYSQL_ROOT_PASSWORD=.*$', "MYSQL_ROOT_PASSWORD=$mysqlRootSecret"
  $envText = $envText -replace '(?m)^MYSQL_PASSWORD=.*$', "MYSQL_PASSWORD=$mysqlAppSecret"
  Set-Content -LiteralPath .env.local -Value $envText -Encoding utf8
}
finally {
  $rng.Dispose()
  Remove-Variable mysqlRootSecret,mysqlAppSecret,rootBytes,appBytes -ErrorAction SilentlyContinue
}
```

Fill in the remaining mail and application values in `.env.local`. If port 3306 is already occupied, set `MYSQL_PORT=3307` before starting the container.

Confirm that Git ignores the secret file and tracks only the example:

```powershell
git check-ignore -v .env.local
git check-ignore .env.example
```

The first command must show an ignore rule. The second command must produce no output and return a nonzero status because the example is intentionally tracked. Never commit, paste into chat, or include `.env.local` in a backup.

## Start and validate MySQL

Validate interpolation before Docker creates anything:

```powershell
docker compose --env-file .env.local -f compose.mysql.yml config --quiet
```

Pull the pinned image, start MySQL, and wait for its health check:

```powershell
docker compose --env-file .env.local -f compose.mysql.yml pull mysql
docker compose --env-file .env.local -f compose.mysql.yml up -d --wait mysql
docker compose --env-file .env.local -f compose.mysql.yml ps
```

Verify the server through the application account without exposing its password in the host command line:

```powershell
docker compose --env-file .env.local -f compose.mysql.yml exec mysql sh -lc 'MYSQL_PWD="$MYSQL_PASSWORD" mysql --user="$MYSQL_USER" --database="$MYSQL_DATABASE" --execute="SELECT VERSION(), CURRENT_USER(), @@character_set_server, @@collation_server, @@time_zone;"'
```

Expected server settings are MySQL `8.4.11`, `utf8mb4`, `utf8mb4_0900_ai_ci`, and `+00:00`.

## Apply the schema and import Firestore

Apply every checked-in SQL migration in order:

```powershell
npm run db:mysql:migrate
```

Import the latest complete portable Firestore snapshot, then run the independent reconciliation suite:

```powershell
npm run db:mysql:import
npm run db:mysql:verify
```

To select a specific snapshot, pass its directory after `--`:

```powershell
npm run db:mysql:import -- backups/firestore/portable/2026-08-11T01-47-21-961Z
npm run db:mysql:verify -- backups/firestore/portable/2026-08-11T01-47-21-961Z
```

The importer verifies the portable manifest and every NDJSON SHA-256 checksum before opening MySQL. Its normalized writes are transactional and keyed by the snapshot, so rerunning the same import makes no row changes. Verification reports are written under the ignored `backups/mysql/reports/` directory.

Unresolved reviewer identities are retained with a nullable reviewer foreign key and their original ID/name snapshots. They must be resolved through an explicit reviewed mapping before production cutover; the importer never guesses with substring matching.

Use the same Compose prefix for all local lifecycle commands:

```powershell
docker compose --env-file .env.local -f compose.mysql.yml stop
docker compose --env-file .env.local -f compose.mysql.yml start
docker compose --env-file .env.local -f compose.mysql.yml logs --tail 100 mysql
```

`docker compose ... down` removes the container and network but preserves the named database volume. The next `up` reuses the existing data.

## Initialization and credential changes

The official MySQL image applies `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`, and `MYSQL_ROOT_PASSWORD` only when `/var/lib/mysql` is empty. Editing `.env.local` after the first successful initialization does not change credentials inside an existing database volume.

For a database that contains useful data, change credentials with MySQL account-management statements and verify the application before updating the env file. Do not reset the volume merely to rotate a password.

For a disposable, unimported local database only, this command performs a complete reset:

```powershell
docker compose --env-file .env.local -f compose.mysql.yml down --volumes
```

`--volumes` permanently deletes the local MySQL data volume. Run it only after confirming the target Compose project and, when data matters, creating and verifying a backup. Files under `backups/mysql/` are bind-mounted and are not removed by this command.

## Create a local SQL backup

Create the ignored backup directory, dump the configured database transactionally, and calculate a host-side checksum:

```powershell
New-Item -ItemType Directory -Force backups\mysql | Out-Null
$backupFile = "erec-review-$(Get-Date -Format 'yyyyMMdd-HHmmss').sql"

docker compose --env-file .env.local -f compose.mysql.yml exec -T -e BACKUP_FILE="$backupFile" mysql sh -lc 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump --user=root --single-transaction --routines --triggers --events --hex-blob --set-gtid-purged=OFF "$MYSQL_DATABASE" > "/backups/$BACKUP_FILE"'

Get-Item (Join-Path backups\mysql $backupFile) | Select-Object FullName,Length,LastWriteTime
Get-FileHash (Join-Path backups\mysql $backupFile) -Algorithm SHA256
```

Treat SQL dumps as sensitive because they contain reviewer, protocol, and mailing data. Keep at least one encrypted copy outside the repository and outside the machine before the final cutover.

## Restore drill

Restore into a separate empty database so the active local database is not overwritten. The fixed drill database name below intentionally fails if it already exists; inspect or remove an old drill database deliberately before repeating the test.

```powershell
$backupFile = 'erec-review-YYYYMMDD-HHMMSS.sql'

docker compose --env-file .env.local -f compose.mysql.yml exec -T mysql sh -lc 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --user=root --execute="CREATE DATABASE erec_review_restore CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"'

docker compose --env-file .env.local -f compose.mysql.yml exec -T -e BACKUP_FILE="$backupFile" mysql sh -lc 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --user=root erec_review_restore < "/backups/$BACKUP_FILE"'

docker compose --env-file .env.local -f compose.mysql.yml exec -T mysql sh -lc 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --user=root --database=erec_review_restore --execute="SHOW TABLES;"'
```

A successful import command is not enough by itself. Give the local application user read-only access to the drill database, run the same 34 reconciliation checks, and then remove the temporary grant when the drill is complete:

```powershell
'GRANT SELECT ON erec_review_restore.* TO ''erec_app''@''%'';' | docker compose --env-file .env.local -f compose.mysql.yml exec -T mysql sh -lc 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --user=root'

$env:MYSQL_DATABASE = 'erec_review_restore'
try {
  npm run db:mysql:verify
}
finally {
  Remove-Item Env:MYSQL_DATABASE -ErrorAction SilentlyContinue
}

'REVOKE SELECT ON erec_review_restore.* FROM ''erec_app''@''%'';' | docker compose --env-file .env.local -f compose.mysql.yml exec -T mysql sh -lc 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --user=root'
```

The verifier must pass the table counts, relationship checks, assignment/completion totals, and source-lineage reconciliation used for the original import.

## Troubleshooting

- **Port 3306 is already in use:** choose another host port in `.env.local`, such as `MYSQL_PORT=3307`. The container still listens on port 3306 internally.
- **Container is unhealthy:** inspect `docker compose --env-file .env.local -f compose.mysql.yml logs --tail 200 mysql` before resetting anything.
- **Access denied after editing the env file:** the existing named volume still has the original credentials. Follow the credential-change guidance above.
- **Unexpected old tables after `up`:** Compose reused the named volume as designed. Inspect and back it up before considering the destructive `down --volumes` reset.

