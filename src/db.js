'use strict';
const { Pool } = require('pg');
const { cfg } = require('./config');

const pool = new Pool({
  host: cfg.db.host,
  port: cfg.db.port,
  database: cfg.db.database,
  user: cfg.db.user,
  password: cfg.db.password,
  ssl: cfg.db.ssl ? { rejectUnauthorized: false } : false, // RDS: encrypted in transit
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
pool.on('error', (e) => console.error('[db] idle client error', e.message));

module.exports = { pool };
