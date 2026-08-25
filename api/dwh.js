const sql = require('mssql');

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

  let pool;
  try {
    const config = {
      server: process.env.MSSQL_SERVER || '203.202.241.211',
      port: parseInt(process.env.MSSQL_PORT || '1433', 10),
      database: process.env.MSSQL_DATABASE || 'DWH',
      user: process.env.MSSQL_USER || 'mcp_user',
      password: process.env.MSSQL_PASSWORD,
      options: {
        encrypt: (process.env.MSSQL_ENCRYPT || 'false') === 'true',
        trustServerCertificate: true
      },
      connectionTimeout: 15000,
      requestTimeout: 30000,
      pool: { max: 1, min: 0, idleTimeoutMillis: 15000 }
    };
    pool = await sql.connect(config);
    const plantFilter = plant && plant !== 'all' ? `AND strPlantName = @plant` : '';

    // ---------- Summary (sum-based aggregates) ----------
    const sumReq = new sql.Request(pool);
    if (plant && plant !== 'all') sumReq.input('plant', sql.NVarChar, plant);
    if (days) sumReq.input('days', sql.Int, days);
    const sumRes = await sumReq.query(`
      SELECT
        COUNT(*) AS records,
        SUM(numAvailableMinute) AS avail_min,
        SUM(numShiftDurationMinute) AS dur_min,
        SUM(numNptLossTimeInMinutes) AS npt_min,
        SUM(numActualOutputQuantity) AS actual_out,
        SUM(numGoodOutputQuantity) AS good_out,
        SUM(numShiftTargetQuantity) AS target_out
      FROM mes.tblOeeProdWasteHeaderArc
      WHERE dteProductionDate >= DATEADD(day, -@days, CAST(GETDATE() AS date))
        ${plantFilter}
    `);
    const s = sumRes.recordset[0] || {};
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
    const trendReq = new sql.Request(pool);
    if (plant && plant !== 'all') trendReq.input('plant', sql.NVarChar, plant);
    if (days) trendReq.input('days', sql.Int, days);
    const trendRes = await trendReq.query(`
      SELECT
        CONVERT(varchar(10), dteProductionDate, 23) AS production_date,
        SUM(numAvailableMinute) AS avail_min,
        SUM(numShiftDurationMinute) AS dur_min,
        SUM(numNptLossTimeInMinutes) AS npt_min,
        SUM(numActualOutputQuantity) AS actual_out,
        SUM(numGoodOutputQuantity) AS good_out,
        SUM(numShiftTargetQuantity) AS target_out,
        COUNT(*) AS records
      FROM mes.tblOeeProdWasteHeaderArc
      WHERE dteProductionDate >= DATEADD(day, -@days, CAST(GETDATE() AS date))
        ${plantFilter}
      GROUP BY CONVERT(varchar(10), dteProductionDate, 23)
      ORDER BY production_date
    `);

    const trend = (trendRes.recordset || []).map(r => {
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
    const machReq = new sql.Request(pool);
    if (plant && plant !== 'all') machReq.input('plant', sql.NVarChar, plant);
    if (days) machReq.input('days', sql.Int, days);
    const machRes = await machReq.query(`
      SELECT TOP 50
        strPlantName, strShopFloorName, strMachineName, stritemName, strUOMName,
        CONVERT(varchar(10), dteProductionDate, 23) AS production_date, strShiftName,
        numShiftTargetQuantity, numActualOutputQuantity, numGoodOutputQuantity,
        numCapacityPerHr, numNptLossTimeInMinutes, numShiftDurationMinute,
        numAvailableMinute
      FROM mes.tblOeeProdWasteHeaderArc
      WHERE dteProductionDate >= DATEADD(day, -@days, CAST(GETDATE() AS date))
        ${plantFilter}
      ORDER BY dteProductionDate DESC, numActualOutputQuantity DESC
    `);

    const machines = (machRes.recordset || []).map(r => {
      const a = mk(r.numAvailableMinute), d = mk(r.numShiftDurationMinute), n = mk(r.numNptLossTimeInMinutes);
      const act = mk(r.numActualOutputQuantity), g = mk(r.numGoodOutputQuantity), t = mk(r.numShiftTargetQuantity);
      const availability = (d > 0 && a !== null) ? Math.min(a / d, 1) : null;
      const performance = (t > 0 && act !== null) ? Math.min(act / t, 1) : null;
      const quality = (act > 0 && g !== null) ? Math.min(g / act, 1) : null;
      const nptPct = (d > 0 && n !== null) ? Math.min(n / d, 1) : null;
      return {
        plant: r.strPlantName,
        shopfloor: r.strShopFloorName,
        machine: r.strMachineName,
        item: r.stritemName,
        uom: r.strUOMName,
        production_date: r.production_date,
        shift: r.strShiftName,
        target: t,
        actual: act,
        good: g,
        capacity_per_hr: mk(r.numCapacityPerHr),
        npt_min: n,
        shift_min: d,
        availability_pct: availability,
        performance_pct: performance,
        quality_pct: quality,
        oee_pct: oeeFrom(availability, performance, quality),
        npt_pct: nptPct
      };
    });

    // ---------- Plants list ----------
    const plantReq = new sql.Request(pool);
    const plantRes = await plantReq.query(`
      SELECT DISTINCT strPlantName FROM mes.tblOeeProdWasteHeaderArc
      WHERE strPlantName IS NOT NULL AND LTRIM(RTRIM(strPlantName)) <> ''
      ORDER BY strPlantName
    `);

    res.status(200).json({
      summary,
      trend,
      machines,
      plants: (plantRes.recordset || []).map(r => r.strPlantName.trim()),
      days
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (pool) await pool.close();
  }
};
