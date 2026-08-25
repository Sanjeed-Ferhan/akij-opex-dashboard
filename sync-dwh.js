const sql = require('mssql');
const { Client } = require('pg');

// ---- MSSQL (source: DWH) ----
const MSSQL = {
  server: process.env.MSSQL_SERVER || '203.202.241.211',
  port: parseInt(process.env.MSSQL_PORT || '1433', 10),
  database: process.env.MSSQL_DATABASE || 'DWH',
  user: process.env.MSSQL_USER || 'mcp_user',
  password: process.env.MSSQL_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
  connectionTimeout: 15000,
  requestTimeout: 120000,
  pool: { max: 1 }
};

// ---- Postgres (destination: ArlOpexDB) ----
const PG = {
  host: process.env.PGHOST || 'arl-community-developer.postgres.database.azure.com',
  port: parseInt(process.env.PGPORT || '5432', 10),
  database: process.env.PGDATABASE || 'ArlOpexDB',
  user: process.env.PGUSER || 'deputy.coo@akijresource.com',
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false }
};

async function main() {
  const days = parseInt(process.env.SYNC_DAYS || '30', 10) || 30;

  console.log('Connecting to MSSQL DWH...');
  const mssqlPool = await sql.connect(MSSQL);

  console.log('Fetching OEE records (last ' + days + ' days)...');
  const req = new sql.Request(mssqlPool);
  req.input('days', sql.Int, days);
  const res = await req.query(`
    SELECT
      intOeeProdWasteHeaderId,
      strPlantName,
      strShopFloorName,
      strMachineName,
      stritemName,
      strUOMName,
      dteProductionDate,
      strShiftName,
      numShiftTargetQuantity,
      numActualOutputQuantity,
      numGoodOutputQuantity,
      numCapacityPerHr,
      numNptLossTimeInMinutes,
      numShiftDurationMinute,
      numAvailableMinute
    FROM mes.tblOeeProdWasteHeaderArc
    WHERE dteProductionDate >= DATEADD(day, -@days, CAST(GETDATE() AS date))
  `);
  const rows = res.recordset || [];
  console.log('Fetched ' + rows.length + ' records');

  await mssqlPool.close();
  console.log('MSSQL connection closed');

  console.log('Connecting to Postgres ArlOpexDB...');
  const pg = new Client(PG);
  await pg.connect();

  await pg.query('BEGIN');
  try {
    // Delete the sync window first to keep idempotent
    const oldest = rows.length ? rows.reduce((a, r) => r.dteProductionDate < a ? r.dteProductionDate : a, rows[0].dteProductionDate) : null;
    if (oldest) {
      await pg.query(`DELETE FROM dwh_oee WHERE production_date >= $1`, [oldest]);
    } else {
      await pg.query(`DELETE FROM dwh_oee`);
    }

    const cols = ['oee_header_id','plant','shopfloor','machine','item','uom','production_date','shift','shift_target_qty','actual_output_qty','good_output_qty','capacity_per_hr','npt_loss_min','shift_duration_min','available_min'];
    const BATCH = 200;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const placeholders = batch.map((_, rIdx) => `(${cols.map((_, cIdx) => `$${rIdx * cols.length + cIdx + 1}`).join(',')})`).join(',');
      const flatParams = batch.flatMap(r => [
        r.intOeeProdWasteHeaderId,
        r.strPlantName,
        r.strShopFloorName,
        r.strMachineName,
        r.stritemName,
        r.strUOMName,
        r.dteProductionDate instanceof Date ? r.dteProductionDate.toISOString().slice(0, 10) : String(r.dteProductionDate).slice(0, 10),
        r.strShiftName,
        r.numShiftTargetQuantity,
        r.numActualOutputQuantity,
        r.numGoodOutputQuantity,
        r.numCapacityPerHr,
        r.numNptLossTimeInMinutes,
        r.numShiftDurationMinute,
        r.numAvailableMinute
      ]);
      await pg.query(`INSERT INTO dwh_oee (${cols.join(',')}) VALUES ${placeholders}`, flatParams);
      inserted += batch.length;
      process.stdout.write(`\r  Synced ${inserted}/${rows.length}`);
    }
    console.log('');
    await pg.query('COMMIT');
    console.log('Synced ' + inserted + ' records into dwh_oee');
  } catch (err) {
    await pg.query('ROLLBACK');
    throw err;
  } finally {
    await pg.end();
  }
  console.log('Done');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
