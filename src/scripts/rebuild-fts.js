const Database = require('better-sqlite3');
const { DB_PATH } = require('../db/constants');

/**
 * Drops the existing FTS table and rebuilds it from the products table.
 * This is useful after changing the FTS configuration (e.g., tokenizer).
 */
function rebuildFTS() {
  if (!require('fs').existsSync(DB_PATH)) {
    console.error(`❌ Database file not found at ${DB_PATH}. Please run the main import script first.`);
    process.exit(1);
  }

  console.log(`🚀 Opening database ${DB_PATH} for FTS rebuild...`);
  const db = new Database(DB_PATH); // Must be read-write

  try {
    console.log('--- Step 1: Dropping old FTS table...');
    db.exec('DROP TABLE IF EXISTS products_fts;');
    console.log('✅ Old FTS table dropped.');

    console.log('\n--- Step 2: Creating new FTS table with porter tokenizer...');
    const createFtsTable = `
      CREATE VIRTUAL TABLE products_fts USING fts5(
        id,
        search_text,
        content='products',
        content_rowid='rowid',
        tokenize='porter ascii'
      );
    `;
    db.exec(createFtsTable);
    console.log('✅ New FTS table created.');

    console.log('\n--- Step 3: Repopulating FTS index from products table...');
    const startTime = Date.now();
    db.exec(`
      INSERT INTO products_fts(rowid, id, search_text) 
      SELECT rowid, id, search_text FROM products;
    `);
    const duration = (Date.now() - startTime) / 1000;
    console.log(`✅ FTS index repopulated in ${duration.toFixed(2)} seconds.`);
    
    console.log('\n--- Step 4: Optimizing FTS index...');
    db.exec("INSERT INTO products_fts(products_fts) VALUES('rebuild');");
    console.log('✅ FTS index optimized.');
    
    console.log('\n--- Step 5: Vacuuming database...');
    db.exec('VACUUM;');
    console.log('✅ Database vacuumed.');
    
  } catch (err) {
    console.error('❌ An error occurred during the FTS rebuild process:', err);
  } finally {
    if (db) {
      db.close();
      console.log('\n🎉 FTS rebuild complete. Database connection closed.');
    }
  }
}

rebuildFTS(); 