import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import mysql from 'mysql2/promise';

const migrationsDirectory = path.resolve(process.cwd(), 'db', 'migrations');

function sha256(value) {
  return createHash('sha256').update(value).digest();
}

function connectionOptions() {
  const database = process.env.MYSQL_DATABASE;
  const password = process.env.MYSQL_MIGRATION_PASSWORD || process.env.MYSQL_ROOT_PASSWORD;

  if (!database || !password) {
    throw new Error('Set MYSQL_DATABASE and MYSQL_ROOT_PASSWORD (or MYSQL_MIGRATION_PASSWORD).');
  }

  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_MIGRATION_USER || 'root',
    password,
    database,
    timezone: 'Z',
    multipleStatements: true,
  };
}

async function hasMigrationTable(connection) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS count
       FROM information_schema.tables
      WHERE table_schema = ? AND table_name = 'schema_migrations'`,
    [process.env.MYSQL_DATABASE]
  );
  return Number(rows[0].count) === 1;
}

async function main() {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort((left, right) => left.localeCompare(right));

  if (files.length === 0) {
    throw new Error(`No SQL migrations found in ${migrationsDirectory}.`);
  }

  const connection = await mysql.createConnection(connectionOptions());
  try {
    await connection.query("SET time_zone = '+00:00'");

    for (const file of files) {
      const version = file.match(/^(\d+)_/)[1];
      const sql = await readFile(path.join(migrationsDirectory, file), 'utf8');
      const checksum = sha256(sql);
      let existing = null;

      if (await hasMigrationTable(connection)) {
        const [rows] = await connection.execute(
          'SELECT checksum_sha256 FROM schema_migrations WHERE version = ?',
          [version]
        );
        existing = rows[0] ?? null;
      }

      if (existing) {
        if (existing.checksum_sha256 && !Buffer.from(existing.checksum_sha256).equals(checksum)) {
          throw new Error(`Migration ${version} checksum differs from the applied migration.`);
        }
        if (!existing.checksum_sha256) {
          await connection.execute(
            'UPDATE schema_migrations SET checksum_sha256 = ? WHERE version = ?',
            [checksum, version]
          );
        }
        console.log(`Migration ${version} already applied (${file}).`);
        continue;
      }

      console.log(`Applying migration ${version} (${file})...`);
      await connection.query(sql);
      await connection.execute(
        'UPDATE schema_migrations SET checksum_sha256 = ? WHERE version = ?',
        [checksum, version]
      );
      console.log(`Applied migration ${version}.`);
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('MySQL migration failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
