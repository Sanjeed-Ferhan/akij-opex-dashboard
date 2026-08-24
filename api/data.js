const { Client } = require('pg');

const ALLOWED_TABLES = new Set([
  'capacity',
  'daily_meeting_form',
  'daily_meeting_target',
  'problem_solving_log',
  'qcp_audit',
  'qcp_specs',
  'target_oee',
  'tasks',
  'task_updates',
  'cost_savings',
  'environment_impact',
  'four_hour_tracking',
  'improvement_cards',
  'kpi_target',
  'problem_solving_cards',
  'process_standardization',
  'productivity_improvement',
  'accl_5s_audit_entries'
]);

const ssl = { rejectUnauthorized: false };

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const table = (req.query.table || '').toLowerCase();
  if (!ALLOWED_TABLES.has(table)) {
    return res.status(400).json({ error: 'Invalid or unauthorized table' });
  }

  const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;

  const client = new Client({
    host: process.env.PGHOST,
    port: parseInt(process.env.PGPORT || '5432', 10),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl
  });

  try {
    await client.connect();
    let sql = `SELECT * FROM public."${table}"`;
    if (limit) sql += ` LIMIT ${limit}`;
    const result = await client.query(sql);
    res.status(200).json({ table, count: result.rowCount, rows: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await client.end();
  }
};
