import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

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
    .filter((entry) => entry.isDirectory() && !entry.name.endsWith('.incomplete'))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));

  if (completedDirectories.length === 0) {
    throw new Error(`No completed portable backups found under ${backupRoot}.`);
  }

  return path.join(backupRoot, completedDirectories[0]);
}

function ensureBackupFilePath(dataDirectory, relativeFilePath) {
  if (typeof relativeFilePath !== 'string' || !relativeFilePath.endsWith('.ndjson')) {
    throw new Error(`Invalid backup data filename in manifest: ${relativeFilePath}`);
  }

  const resolvedDataDirectory = path.resolve(dataDirectory);
  const resolvedFile = path.resolve(dataDirectory, relativeFilePath);

  if (!resolvedFile.startsWith(`${resolvedDataDirectory}${path.sep}`)) {
    throw new Error(`Backup data filename escapes the data directory: ${relativeFilePath}`);
  }

  return resolvedFile;
}

async function verifyNdjsonFile(filePath, expectedCount, seenDocumentPaths) {
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let count = 0;

  for await (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    let record;

    try {
      record = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSON at ${filePath}:${count + 1}: ${error instanceof Error ? error.message : error}`);
    }

    if (!record || typeof record.path !== 'string' || !record.path.trim()) {
      throw new Error(`Missing Firestore document path at ${filePath}:${count + 1}.`);
    }

    if (seenDocumentPaths.has(record.path)) {
      throw new Error(`Duplicate Firestore document path found across backup files: ${record.path}`);
    }

    seenDocumentPaths.add(record.path);
    count += 1;
  }

  if (count !== expectedCount) {
    throw new Error(`Record count mismatch for ${filePath}. Expected ${expectedCount}, found ${count}.`);
  }

  return count;
}

async function verifyBackup() {
  const backupRoot = path.resolve(process.cwd(), 'backups', 'firestore', 'portable');
  const requestedPath = process.argv[2];
  const backupDirectory = requestedPath
    ? path.resolve(process.cwd(), requestedPath)
    : await findLatestBackup(backupRoot);
  const manifestPath = path.join(backupDirectory, 'manifest.json');
  const dataDirectory = path.join(backupDirectory, 'data');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  if (manifest.format !== 'e-rec-portable-firestore-backup' || manifest.status !== 'complete') {
    throw new Error(`Unsupported or incomplete backup manifest at ${manifestPath}.`);
  }

  if (!Array.isArray(manifest.sources)) {
    throw new Error('Backup manifest does not contain a sources array.');
  }

  const seenDocumentPaths = new Set();

  console.log(`Verifying portable Firestore backup: ${backupDirectory}`);

  for (const source of manifest.sources) {
    const filePath = ensureBackupFilePath(dataDirectory, source.file);
    const actualHash = await sha256File(filePath);

    if (actualHash !== source.sha256) {
      throw new Error(`SHA-256 mismatch for ${source.file}. Expected ${source.sha256}, found ${actualHash}.`);
    }

    const count = await verifyNdjsonFile(filePath, source.count, seenDocumentPaths);
    console.log(`  ${source.file}: ${count} document(s), checksum OK`);
  }

  if (seenDocumentPaths.size !== manifest.totalDocuments) {
    throw new Error(
      `Total document count mismatch. Expected ${manifest.totalDocuments}, found ${seenDocumentPaths.size}.`
    );
  }

  console.log('');
  console.log('Portable Firestore backup verification passed.');
  console.log(`Documents: ${seenDocumentPaths.size}`);
  console.log(`Project: ${manifest.source?.firebaseProjectId || 'unknown'}`);
}

verifyBackup().catch((error) => {
  console.error('Portable Firestore backup verification failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
