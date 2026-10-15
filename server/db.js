const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function query(sql, params) {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function one(sql, params) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

// Creates the tables if they don't exist yet, and the single driver_state row.
async function setup() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  const invite = crypto.randomBytes(9).toString('base64url');
  await query(
    'INSERT INTO driver_state (id, invite_code) VALUES (1, $1) ON CONFLICT (id) DO NOTHING',
    [invite]
  );
}

module.exports = { pool, query, one, setup };
