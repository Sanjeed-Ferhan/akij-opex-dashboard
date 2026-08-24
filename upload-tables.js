const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const client = new Client({
  host: 'arl-community-developer.postgres.database.azure.com',
  port: 5432,
  database: 'ArlOpexDB',
  user: 'deputy.coo@akijresource.com',
  password: 'RalTn76abw!379',
  ssl: { rejectUnauthorized: false }
});

const TABLES = [
  {
    file: '4-hour tracking.csv',
    table: 'four_hour_tracking',
    columns: ['id','entry_date','shift_name','time_slot','line','sbu','name','email','major_breakdown','absent_department','notes','created_at','submitted_at','target_qty','actual_qty','gap_qty']
  },
  {
    file: 'accl_cost_savings.csv',
    table: 'cost_savings',
    columns: ['id','sl','source','card_no','project_details','section','uom','start_date','completed_date','monthly_values','created_at','updated_at','hidden','total_savings_bdt','sbu']
  },
  {
    file: 'accl_environment_impact.csv',
    table: 'environment_impact',
    columns: ['id','sl','source','card_no','project_details','section','uom','start_date','completed_date','monthly_values','created_at','updated_at','hidden']
  },
  {
    file: 'accl_improvement_cards.csv',
    table: 'improvement_cards',
    columns: ['id','card_no','sbu','dept','provider','created_date','details','benefit','status','target_date','accepted_date','hidden','created_at','updated_at']
  },
  {
    file: 'ACCL_KPI_TARGET.csv',
    table: 'kpi_target',
    columns: ['id','sbu','kpi_id','kpi_label','unit','month','monthly_target','created_at']
  },
  {
    file: 'accl_problem_solving_cards.csv',
    table: 'problem_solving_cards',
    columns: ['id','card_no','sbu','dept','provider','created_date','problem_description','root_cause','corrective_action','status','target_date','accepted_date','hidden','created_at','updated_at']
  },
  {
    file: 'accl_process_standardization.csv',
    table: 'process_standardization',
    columns: ['id','start_date','project_name','sbu','status','is_finalized','summary','created_at']
  },
  {
    file: 'accl_productivity_improvement.csv',
    table: 'productivity_improvement',
    columns: ['id','sl','source','card_no','project_details','section','uom','start_date','completed_date','monthly_values','created_at','updated_at','hidden']
  }
];

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function cleanValue(val) {
  if (val === undefined || val === null || val.trim() === '') return null;
  const trimmed = val.trim();
  if (trimmed === '""' || trimmed === "''") return null;
  return trimmed;
}

function escapeStr(val) {
  if (val === null) return 'NULL';
  return "'" + val.replace(/'/g, "''").replace(/\\/g, '\\\\') + "'";
}

async function uploadTable(tableName, columns, filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim() !== '');
  
  if (lines.length < 2) {
    console.log(`  Skipping ${tableName}: no data rows`);
    return 0;
  }

  const headerLine = lines[0];
  const dataLines = lines.slice(1);

  await client.query(`DROP TABLE IF EXISTS public."${tableName}" CASCADE`);
  
  const colDefs = columns.map(c => {
    if (c === 'id' || c === 'sl' || c === 'hidden' || c === 'is_finalized') return `"${c}" TEXT`;
    if (c.includes('_date') || c.includes('_at')) return `"${c}" TEXT`;
    if (c.includes('_target') || c.includes('_savings') || c.includes('qty')) return `"${c}" TEXT`;
    return `"${c}" TEXT`;
  }).join(',\n  ');

  await client.query(`CREATE TABLE public."${tableName}" (\n  ${colDefs}\n)`);

  let inserted = 0;
  const batchSize = 50;

  for (let i = 0; i < dataLines.length; i += batchSize) {
    const batch = dataLines.slice(i, i + batchSize);
    const values = batch.map(line => {
      const fields = parseCSVLine(line);
      const cleaned = fields.map(f => cleanValue(f));
      while (cleaned.length < columns.length) cleaned.push(null);
      return `(${cleaned.map(v => escapeStr(v)).join(', ')})`;
    });

    const cols = columns.map(c => `"${c}"`).join(', ');
    const sql = `INSERT INTO public."${tableName}" (${cols}) VALUES ${values.join(',\n')}`;
    await client.query(sql);
    inserted += batch.length;
    process.stdout.write(`\r  Inserted ${inserted}/${dataLines.length} rows`);
  }
  console.log('');
  return inserted;
}

async function main() {
  try {
    await client.connect();
    console.log('Connected to PostgreSQL\n');

    const baseDir = 'C:\\Users\\ferha\\Downloads\\supabase_export';

    for (const cfg of TABLES) {
      const filePath = path.join(baseDir, cfg.file);
      if (!fs.existsSync(filePath)) {
        console.log(`File not found: ${cfg.file}`);
        continue;
      }

      console.log(`\nUploading: ${cfg.file} -> ${cfg.table}`);
      const count = await uploadTable(cfg.table, cfg.columns, filePath);
      console.log(`  Done: ${count} rows`);
    }

    console.log('\nAll tables uploaded successfully!');
    await client.end();
  } catch (err) {
    console.error('Error:', err.message);
    await client.end();
  }
}

main();
