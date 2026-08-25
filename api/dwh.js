const { Client } = require('pg');

function mk(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function oeeFrom(a, p, q) {
  if (a !== null && p !== null && q !== null && a > 0 && p > 0 && q > 0) {
    return Math.min(a * p * q, 1);
  }
  return null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const plant = (req.query.plant || '').toString();
  const days = Math.min(parseInt(req.query.days || '7', 10) || 7, 30);

  const client = new Client({
    host: process.env.PGHOST,
    port: parseInt(process.env.PGPORT || '5432', 10),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    const plantFilter = plant && plant !== 'all' ? `AND plant = $2` : '';
    const params = [days];
    if (plant && plant !== 'all') params.push(plant);

    // ---------- Summary (sum-based aggregates) ----------
    const sumRes = await client.query(`
      SELECT
        COUNT(*)::int AS records,
        SUM(available_min) AS avail_min,
        SUM(shift_duration_min) AS dur_min,
        SUM(npt_loss_min) AS npt_min,
        SUM(actual_output_qty) AS actual_out,
        SUM(good_output_qty) AS good_out,
        SUM(shift_target_qty) AS target_out
      FROM dwh_oee
      WHERE production_date >= CURRENT_DATE - ($1 || ' days')::interval
        ${plantFilter}
    `, params);
    const s = sumRes.rows[0] || {};
    const avail = mk(s.avail_min), dur = mk(s.dur_min), npt = mk(s.npt_min);
    const actual = mk(s.actual_out), good = mk(s.good_out), target = mk(s.target_out);

    const availability = (dur > 0 && avail !== null) ? Math.min(avail / dur, 1) : null;
    const performance = (target > 0 && actual !== null) ? Math.min(actual / target, 1) : null;
    const quality = (actual > 0 && good !== null) ? Math.min(good / actual, 1) : null;
    const nptPct = (dur > 0 && npt !== null) ? Math.min(npt / dur, 1) : null;
    const capUtil = (target > 0 && actual !== null) ? Math.min(actual / target, 1) : null;

    const summary = {
      records: s.records || 0,
      availability_pct: availability,
      performance_pct: performance,
      quality_pct: quality,
      npt_pct: nptPct,
      oee_pct: oeeFrom(availability, performance, quality),
      capacity_util_pct: capUtil,
      total_actual_output: actual || 0,
      total_good_output: good || 0,
      total_target: target || 0
    };

    // ---------- Day-wise trend (sum-based) ----------
    const trendRes = await client.query(`
      SELECT
        production_date::text AS production_date,
        SUM(available_min) AS avail_min,
        SUM(shift_duration_min) AS dur_min,
        SUM(npt_loss_min) AS npt_min,
        SUM(actual_output_qty) AS actual_out,
        SUM(good_output_qty) AS good_out,
        SUM(shift_target_qty) AS target_out,
        COUNT(*)::int AS records
      FROM dwh_oee
      WHERE production_date >= CURRENT_DATE - ($1 || ' days')::interval
        ${plantFilter}
      GROUP BY production_date
      ORDER BY production_date
    `, params);

    const trend = (trendRes.rows || []).map(r => {
      const a = mk(r.avail_min), d = mk(r.dur_min), n = mk(r.npt_min);
      const act = mk(r.actual_out), g = mk(r.good_out), t = mk(r.target_out);
      const availability = (d > 0 && a !== null) ? Math.min(a / d, 1) : null;
      const performance = (t > 0 && act !== null) ? Math.min(act / t, 1) : null;
      const quality = (act > 0 && g !== null) ? Math.min(g / act, 1) : null;
      const nptPct = (d > 0 && n !== null) ? Math.min(n / d, 1) : null;
      return {
        production_date: r.production_date,
        records: r.records || 0,
        actual_output: act || 0,
        good_output: g || 0,
        target_output: t || 0,
        availability_pct: availability,
        performance_pct: performance,
        quality_pct: quality,
        oee_pct: oeeFrom(availability, performance, quality),
        npt_pct: nptPct
      };
    });

    // ---------- Machine level (last N days, top 50 by actual) ----------
    const machRes = await client.query(`
      SELECT
        plant, shopfloor, machine, item, uom,
        production_date::text AS production_date, shift,
        shift_target_qty AS target, actual_output_qty AS actual, good_output_qty AS good,
        capacity_per_hr, npt_loss_min AS npt_min, shift_duration_min AS shift_min,
        available_min,
        CASE WHEN shift_duration_min > 0 THEN LEAST(available_min::float / shift_duration_min, 1) END AS availability_pct,
        CASE WHEN shift_target_qty > 0 THEN LEAST(actual_output_qty::float / shift_target_qty, 1) END AS performance_pct,
        CASE WHEN actual_output_qty > 0 THEN LEAST(good_output_qty::float / actual_output_qty, 1) END AS quality_pct,
        CASE WHEN shift_duration_min > 0 THEN LEAST(npt_loss_min::float / shift_duration_min, 1) END AS npt_pct
      FROM dwh_oee
      WHERE production_date >= CURRENT_DATE - ($1 || ' days')::interval
        ${plantFilter}
      ORDER BY production_date DESC, actual_output_qty DESC
      LIMIT 50
    `, params);

    const machines = (machRes.rows || []).map(r => ({
      plant: r.plant,
      shopfloor: r.shopfloor,
      machine: r.machine,
      item: r.item,
      uom: r.uom,
      production_date: r.production_date,
      shift: r.shift,
      target: mk(r.target),
      actual: mk(r.actual),
      good: mk(r.good),
      capacity_per_hr: mk(r.capacity_per_hr),
      npt_min: mk(r.npt_min),
      shift_min: mk(r.shift_min),
      availability_pct: mk(r.availability_pct),
      performance_pct: mk(r.performance_pct),
      quality_pct: mk(r.quality_pct),
      oee_pct: oeeFrom(mk(r.availability_pct), mk(r.performance_pct), mk(r.quality_pct)),
      npt_pct: mk(r.npt_pct)
    }));

    // ---------- Plants list ----------
    const plantRes = await client.query(`
      SELECT DISTINCT plant FROM dwh_oee
      WHERE plant IS NOT NULL AND BTRIM(plant) <> ''
      ORDER BY plant
    `);

    res.status(200).json({
      summary,
      trend,
      machines,
      plants: (plantRes.rows || []).map(r => r.plant.trim()),
      days,
      source: 'postgres-dwh_oee'
    });
  } catch (err) {
    res.status(500).json({ error: (err && err.message) || String(err), code: (err && err.code) || null });
  } finally {
    await client.end();
  }
};
