import 'server-only';

import mysql, {
  type Pool,
  type PoolConnection,
  type RowDataPacket,
} from 'mysql2/promise';

type GlobalMysql = typeof globalThis & { __erecMysqlPool?: Pool };

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required for the MySQL connection.`);
  }

  return value;
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function createMysqlPool(): Pool {
  const sslEnabled = process.env.MYSQL_SSL === 'true';
  const sslCa = process.env.MYSQL_SSL_CA?.replace(/\\n/g, '\n');

  return mysql.createPool({
    host: requiredEnv('MYSQL_HOST'),
    port: positiveIntegerEnv('MYSQL_PORT', 3306),
    database: process.env.MYSQL_DATABASE?.trim() || 'erec_review',
    user: requiredEnv('MYSQL_USER'),
    password: requiredEnv('MYSQL_PASSWORD'),
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: true,
    namedPlaceholders: false,
    multipleStatements: false,
    waitForConnections: true,
    connectionLimit: positiveIntegerEnv('MYSQL_CONNECTION_LIMIT', 10),
    maxIdle: positiveIntegerEnv('MYSQL_MAX_IDLE', 10),
    idleTimeout: positiveIntegerEnv('MYSQL_IDLE_TIMEOUT_MS', 60_000),
    queueLimit: positiveIntegerEnv('MYSQL_QUEUE_LIMIT', 100),
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    ssl: sslEnabled || sslCa
      ? { ca: sslCa, rejectUnauthorized: true }
      : undefined,
  });
}

const globalMysql = globalThis as GlobalMysql;

export const mysqlPool = globalMysql.__erecMysqlPool ?? createMysqlPool();

if (process.env.NODE_ENV !== 'production') {
  globalMysql.__erecMysqlPool = mysqlPool;
}

export type MysqlExecutor = Pick<Pool | PoolConnection, 'execute' | 'query'>;

export type MysqlParameter =
  | string
  | number
  | bigint
  | boolean
  | Date
  | null
  | Buffer
  | Uint8Array
  | MysqlParameter[]
  | { [key: string]: MysqlParameter };

export function getMysqlPool(): Pool {
  return mysqlPool;
}

export async function queryRows<T extends RowDataPacket>(
  sql: string,
  values: readonly MysqlParameter[] = [],
  executor: MysqlExecutor = mysqlPool
): Promise<T[]> {
  const [rows] = await executor.execute<T[]>(sql, [...values]);
  return rows;
}

export async function withTransaction<T>(
  operation: (connection: PoolConnection) => Promise<T>
): Promise<T> {
  const connection = await mysqlPool.getConnection();

  try {
    await connection.query("SET time_zone = '+00:00'");
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function verifyMysqlConnection(): Promise<void> {
  await queryRows<RowDataPacket>("SELECT 1 AS ok, @@session.time_zone AS time_zone");
}
