const { Client } = require('pg');

const client = new Client({
  host: 'arl-community-developer.postgres.database.azure.com',
  port: 5432,
  database: 'ArlOpexDB',
  user: 'deputy.coo@akijresource.com',
  password: 'RalTn76abw!379',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    await client.connect();
    console.log('Connected successfully!');
    
    const res = await client.query(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    console.log('\nExisting tables:');
    res.rows.forEach(row => console.log(`  - ${row.table_schema}.${row.table_name}`));
    
    await client.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
