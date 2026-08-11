import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

async function readJsonFile(filePath) {
  const contents = await readFile(filePath, 'utf8');

  return JSON.parse(contents.replace(/^\uFEFF/, ''));
}

async function sha256File(filePath) {
  const hash = createHash('sha256');

  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }

  return hash.digest('hex');
}

async function findLatestBackup(backupRoot) {
  const entries = await readdir(backupRoot, { withFileTypes: true });
  const completedDirectories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));

  if (completedDirectories.length === 0) {
    throw new Error(`No managed backups found under ${backupRoot}.`);
  }

  return path.join(backupRoot, completedDirectories[0]);
}

function resolveManifestFile(backupDirectory, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error(`Invalid native backup path in manifest: ${relativePath}`);
  }

  const resolvedBackupDirectory = path.resolve(backupDirectory);
  const resolvedFile = path.resolve(backupDirectory, relativePath);

  if (!resolvedFile.startsWith(`${resolvedBackupDirectory}${path.sep}`)) {
    throw new Error(`Native backup path escapes its backup directory: ${relativePath}`);
  }

  return resolvedFile;
}

async function listFilesRecursively(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await listFilesRecursively(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

async function verifyManagedBackup() {
  const backupRoot = path.resolve(process.cwd(), 'backups', 'firestore', 'managed');
  const requestedPath = process.argv[2];
  const backupDirectory = requestedPath
    ? path.resolve(process.cwd(), requestedPath)
    : await findLatestBackup(backupRoot);
  const manifestPath = path.join(backupDirectory, 'manifest.json');
  const manifest = await readJsonFile(manifestPath);

  if (manifest.format !== 'e-rec-native-firestore-managed-export' || manifest.status !== 'complete') {
    throw new Error(`Unsupported or incomplete managed backup manifest at ${manifestPath}.`);
  }

  if (!Array.isArray(manifest.files) || manifest.files.length !== manifest.fileCount) {
    throw new Error('Managed backup manifest file count is invalid.');
  }

  console.log(`Verifying native managed Firestore backup: ${backupDirectory}`);

  const expectedPaths = new Set();

  for (const file of manifest.files) {
    const filePath = resolveManifestFile(backupDirectory, file.path);
    const fileStats = await stat(filePath);

    if (!fileStats.isFile()) {
      throw new Error(`Managed backup path is not a file: ${file.path}`);
    }

    if (fileStats.size !== file.bytes) {
      throw new Error(`Byte-size mismatch for ${file.path}. Expected ${file.bytes}, found ${fileStats.size}.`);
    }

    const actualHash = await sha256File(filePath);

    if (actualHash !== file.sha256) {
      throw new Error(`SHA-256 mismatch for ${file.path}. Expected ${file.sha256}, found ${actualHash}.`);
    }

    expectedPaths.add(path.resolve(filePath));
    console.log(`  ${file.path}: ${fileStats.size} byte(s), checksum OK`);
  }

  const nativeDirectory = path.join(backupDirectory, 'native');
  const actualNativeFiles = await listFilesRecursively(nativeDirectory);

  if (actualNativeFiles.length !== expectedPaths.size) {
    throw new Error(
      `Native file count mismatch. Manifest has ${expectedPaths.size}, directory has ${actualNativeFiles.length}.`
    );
  }

  for (const actualFile of actualNativeFiles) {
    if (!expectedPaths.has(path.resolve(actualFile))) {
      throw new Error(`Untracked file found in native managed export tree: ${actualFile}`);
    }
  }

  const metadataPath = resolveManifestFile(backupDirectory, manifest.metadataFile);

  if (!metadataPath.endsWith('.overall_export_metadata') || !expectedPaths.has(path.resolve(metadataPath))) {
    throw new Error('The required overall export metadata file is missing from the managed backup manifest.');
  }

  const operationsPath = path.join(backupDirectory, 'manifests', 'firestore-operations.json');
  const operations = await readJsonFile(operationsPath);
  const matchingOperation = Array.isArray(operations)
    ? operations.find((operation) => operation?.metadata?.outputUriPrefix === manifest.exportUri)
    : null;

  if (!matchingOperation || matchingOperation.done !== true || matchingOperation.metadata?.operationState !== 'SUCCESSFUL') {
    throw new Error('Could not confirm a successful Firestore export operation for the manifest output URI.');
  }

  console.log('');
  console.log('Native managed Firestore backup verification passed.');
  console.log(`Files: ${expectedPaths.size}`);
  if (matchingOperation.metadata?.progressDocuments?.completedWork !== undefined) {
    console.log(`Documents: ${matchingOperation.metadata.progressDocuments.completedWork}`);
  }
  console.log(`Project: ${manifest.firebaseProjectId}`);
  console.log(`Export URI: ${manifest.exportUri}`);
}

verifyManagedBackup().catch((error) => {
  console.error('Native managed Firestore backup verification failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
