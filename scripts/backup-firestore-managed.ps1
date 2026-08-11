param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectId,

  [Parameter(Mandatory = $true)]
  [string]$BucketName,

  [string]$DatabaseId = "(default)",

  [string]$BucketLocation,

  [switch]$CreateBucket
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$gcloudCommand = Get-Command gcloud -ErrorAction SilentlyContinue
$gcloudCandidates = @(
  (Join-Path $env:LOCALAPPDATA "Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"),
  "C:\Program Files\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd",
  "C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
)
$script:GcloudExecutable = if ($gcloudCommand) {
  $gcloudCommand.Source
} else {
  $gcloudCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

function Invoke-Gcloud {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $output = @(& $script:GcloudExecutable @Arguments 2>&1 | ForEach-Object { $_.ToString() })
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorActionPreference

  if ($exitCode -ne 0) {
    throw "gcloud $($Arguments -join ' ') failed:`n$($output -join [Environment]::NewLine)"
  }

  return $output
}

if (-not $script:GcloudExecutable) {
  throw "Google Cloud CLI is not installed. Follow docs/database-migration/firestore-backup.md before running this script."
}

$activeAccount = (Invoke-Gcloud -Arguments @(
  "auth", "list", "--filter=status:ACTIVE", "--format=value(account)"
) | Out-String).Trim()

if (-not $activeAccount) {
  throw "No active Google Cloud account was found. Run 'gcloud auth login' first."
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$backupDirectory = Join-Path $repoRoot "backups\firestore\managed\$stamp"
$nativeDirectory = Join-Path $backupDirectory "native"
$manifestDirectory = Join-Path $backupDirectory "manifests"
$exportPrefix = "managed/firestore-$stamp"
$exportUri = "gs://$BucketName/$exportPrefix"

Write-Host "Active Google account: confirmed"
Write-Host "Verifying project: $ProjectId"
$projectDescription = Invoke-Gcloud -Arguments @(
  "projects", "describe", $ProjectId, "--format=json"
)
$billingDescription = Invoke-Gcloud -Arguments @(
  "billing", "projects", "describe", $ProjectId, "--format=json"
)
$billingEnabled = (Invoke-Gcloud -Arguments @(
  "billing", "projects", "describe", $ProjectId, "--format=value(billingEnabled)"
) | Out-String).Trim()

if ($billingEnabled.ToLowerInvariant() -ne "true") {
  throw "Billing is not enabled for project '$ProjectId'. Upgrade the Firebase project to Blaze before running a native managed export."
}

$databaseDescription = Invoke-Gcloud -Arguments @(
  "firestore", "databases", "describe", "--database=$DatabaseId", "--project=$ProjectId", "--format=json"
)
$databaseLocation = (Invoke-Gcloud -Arguments @(
  "firestore", "databases", "describe", "--database=$DatabaseId", "--project=$ProjectId", "--format=value(locationId)"
) | Out-String).Trim()

if (-not $databaseLocation) {
  throw "Could not determine the Firestore database location."
}

if (-not $BucketLocation) {
  if ($databaseLocation -in @("nam5", "nam7", "eur3")) {
    throw "Firestore uses multi-region '$databaseLocation'. Pass an explicit nearby Cloud Storage -BucketLocation after reviewing the documented location guidance."
  }

  $BucketLocation = $databaseLocation
}

Write-Host "Firestore location: $databaseLocation"
Write-Host "Backup bucket: gs://$BucketName ($BucketLocation)"

$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$bucketDescriptionOutput = & $script:GcloudExecutable storage buckets describe "gs://$BucketName" "--project=$ProjectId" "--format=json" 2>&1
$bucketDescribeExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorActionPreference
$bucketExists = $bucketDescribeExitCode -eq 0

if (-not $bucketExists) {
  if (-not $CreateBucket) {
    throw "Bucket gs://$BucketName does not exist or is not accessible. Re-run with -CreateBucket to create a private Standard bucket."
  }

  Write-Host "Creating private backup bucket gs://$BucketName..."
  Invoke-Gcloud -Arguments @(
    "storage", "buckets", "create", "gs://$BucketName",
    "--project=$ProjectId",
    "--location=$BucketLocation",
    "--default-storage-class=STANDARD",
    "--uniform-bucket-level-access",
    "--public-access-prevention"
  ) | Out-Host
} else {
  $bucketDescription = ($bucketDescriptionOutput | Out-String) | ConvertFrom-Json
  $actualBucketLocation = [string]$bucketDescription.location

  if ($actualBucketLocation -and $actualBucketLocation.ToLowerInvariant() -ne $BucketLocation.ToLowerInvariant()) {
    throw "Existing bucket location '$actualBucketLocation' does not match requested location '$BucketLocation'."
  }
}

New-Item -ItemType Directory -Force -Path $nativeDirectory, $manifestDirectory | Out-Null
$startedAt = (Get-Date).ToUniversalTime()

Write-Host "Starting full managed Firestore export to $exportUri..."
Invoke-Gcloud -Arguments @(
  "firestore", "export", $exportUri, "--database=$DatabaseId", "--project=$ProjectId"
) | Tee-Object -FilePath (Join-Path $manifestDirectory "export-command-output.txt") | Out-Host

Invoke-Gcloud -Arguments @(
  "firestore", "operations", "list", "--database=$DatabaseId", "--project=$ProjectId", "--format=json"
) | Set-Content -LiteralPath (Join-Path $manifestDirectory "firestore-operations.json") -Encoding utf8

Invoke-Gcloud -Arguments @(
  "storage", "ls", "--recursive", "--long", $exportUri
) | Set-Content -LiteralPath (Join-Path $manifestDirectory "cloud-object-listing.txt") -Encoding utf8

Write-Host "Downloading the untouched managed export tree..."
Invoke-Gcloud -Arguments @(
  "storage", "cp", "--recursive", $exportUri, $nativeDirectory
) | Out-Host

$metadataFiles = @(Get-ChildItem -LiteralPath $nativeDirectory -Recurse -File -Filter "*.overall_export_metadata")

if ($metadataFiles.Count -ne 1) {
  throw "Expected exactly one .overall_export_metadata file after download, found $($metadataFiles.Count)."
}

$localFiles = @(Get-ChildItem -LiteralPath $nativeDirectory -Recurse -File | Sort-Object FullName)
$localHashes = @($localFiles | ForEach-Object {
  $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256

  [ordered]@{
    path = $_.FullName.Substring($backupDirectory.Length + 1).Replace("\", "/")
    bytes = $_.Length
    sha256 = $hash.Hash.ToLowerInvariant()
  }
})
$completedAt = (Get-Date).ToUniversalTime()
$manifest = [ordered]@{
  format = "e-rec-native-firestore-managed-export"
  formatVersion = 1
  status = "complete"
  firebaseProjectId = $ProjectId
  databaseId = $DatabaseId
  firestoreLocation = $databaseLocation
  bucket = "gs://$BucketName"
  bucketLocation = $BucketLocation
  exportUri = $exportUri
  activeGoogleAccount = $activeAccount
  startedAt = $startedAt.ToString("o")
  completedAt = $completedAt.ToString("o")
  metadataFile = $metadataFiles[0].FullName.Substring($backupDirectory.Length + 1).Replace("\", "/")
  fileCount = $localFiles.Count
  files = $localHashes
}

$projectDescription | Set-Content -LiteralPath (Join-Path $manifestDirectory "project.json") -Encoding utf8
$billingDescription | Set-Content -LiteralPath (Join-Path $manifestDirectory "billing.json") -Encoding utf8
$databaseDescription | Set-Content -LiteralPath (Join-Path $manifestDirectory "database.json") -Encoding utf8
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $backupDirectory "manifest.json") -Encoding utf8

Write-Host ""
Write-Host "Native managed Firestore backup completed."
Write-Host "Files: $($localFiles.Count)"
Write-Host "Location: $backupDirectory"
Write-Host "Cloud copy retained at: $exportUri"
