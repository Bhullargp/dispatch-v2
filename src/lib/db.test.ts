import test from 'node:test';
import assert from 'node:assert/strict';

const ORIGINAL_ENV = { ...process.env };

function resetDbEnv() {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.DB_HOST;
  delete process.env.DB_PORT;
  delete process.env.DB_USER;
  delete process.env.DB_PASSWORD;
  delete process.env.DB_NAME;
  delete process.env.DB_SCHEMA;
  delete process.env.DB_POOL_MAX;
  delete process.env.DB_SSL;
  delete process.env.DATABASE_URL;
}

test('getDbConfig uses defaults when DB env vars are missing', async () => {
  resetDbEnv();
  const { getDbConfig } = await import('./db');

  assert.deepEqual(getDbConfig(), {
    host: '127.0.0.1',
    port: 5432,
    user: 'dispatch_user',
    password: 'karandeep@',
    database: 'masterdb',
    schema: 'dispatch',
    max: 10,
    options: '-c search_path=dispatch',
  });
});

test('getDbConfig uses DATABASE_URL for hosted Postgres', async () => {
  resetDbEnv();
  process.env.DATABASE_URL = 'postgres://dispatch_prod:secret-pass@db.example.internal:6543/dispatch_prod_db';
  process.env.DB_SCHEMA = 'dispatch';
  process.env.DB_POOL_MAX = '3';

  const { getDbConfig } = await import(`./db?case=${Date.now()}`);

  assert.deepEqual(getDbConfig(), {
    connectionString: 'postgres://dispatch_prod:secret-pass@db.example.internal:6543/dispatch_prod_db',
    schema: 'dispatch',
    max: 3,
    options: '-c search_path=dispatch',
    ssl: { rejectUnauthorized: false },
  });
});

test('getDbConfig can disable SSL for local connection strings', async () => {
  resetDbEnv();
  process.env.DATABASE_URL = 'postgres://dispatch_user:secret-pass@127.0.0.1:5432/masterdb';
  process.env.DB_SSL = 'disable';

  const { getDbConfig } = await import(`./db?case=${Date.now()}`);

  assert.deepEqual(getDbConfig(), {
    connectionString: 'postgres://dispatch_user:secret-pass@127.0.0.1:5432/masterdb',
    schema: 'dispatch',
    max: 5,
    options: '-c search_path=dispatch',
  });
});

test('getDbConfig reads DB env vars when provided', async () => {
  resetDbEnv();
  process.env.DB_HOST = 'db.example.internal';
  process.env.DB_PORT = '6543';
  process.env.DB_USER = 'dispatch_prod';
  process.env.DB_PASSWORD = 'secret-pass';
  process.env.DB_NAME = 'dispatch_prod_db';
  process.env.DB_SCHEMA = 'dispatch_prod';
  process.env.DB_POOL_MAX = '22';

  const { getDbConfig } = await import(`./db?case=${Date.now()}`);

  assert.deepEqual(getDbConfig(), {
    host: 'db.example.internal',
    port: 6543,
    user: 'dispatch_prod',
    password: 'secret-pass',
    database: 'dispatch_prod_db',
    schema: 'dispatch_prod',
    max: 22,
    options: '-c search_path=dispatch_prod',
  });
});
