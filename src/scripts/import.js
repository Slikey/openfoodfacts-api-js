/**
 * @fileoverview This script handles the one-time, full import of the
 * OpenFoodFacts dataset from a JSONL file into the SQLite database.
 * It initializes the database schema, reads the source file line by line,
 * transforms the data, and inserts it in batches for efficiency.
 *
 * It is a setup-time script and should not be run when the API is live.
 *
 * @usage `node src/scripts/import.js`
 */
const fs = require('fs');
const readline = require('readline');
const { SOURCE_PATH } = require('../db/constants');
const OpenFoodFactsDB = require('../db/database');
const { transformProduct } = require('../db/transformer');

const BATCH_SIZE = 5000;

/**
 * Prepares the database statements for batch insertion.
 * Using a transaction for batch inserts is significantly faster.
 * @param {OpenFoodFactsDB} db - The database instance.
 * @returns {{insert: Function}} An object with an `insert` function.
 */
function prepareStatements(db) {
  const insertStmt = db.db.prepare(`
    INSERT OR REPLACE INTO products (
      id, code, product_name, brands, categories, countries, energy_kcal, fat_100g,
      saturated_fat_100g, carbohydrates_100g, sugars_100g, proteins_100g, salt_100g,
      fiber_100g, nutriscore_grade, nova_group, ecoscore_grade, completeness, complete_macros,
      last_modified_t, raw_data, search_text
    ) VALUES (
      @id, @code, @product_name, @brands, @categories, @countries, @energy_kcal, @fat_100g,
      @saturated_fat_100g, @carbohydrates_100g, @sugars_100g, @proteins_100g, @salt_100g,
      @fiber_100g, @nutriscore_grade, @nova_group, @ecoscore_grade, @completeness, @complete_macros,
      @last_modified_t, @raw_data, @search_text
    )
  `);

  return {
    insert: db.db.transaction((batch) => {
      for (const product of batch) {
        insertStmt.run(product);
      }
    }),
  };
}

/**
 * Main function to execute the import process.
 * It orchestrates database initialization, file reading, data transformation,
 * and batch insertion.
 */
async function runImport() {
  if (!fs.existsSync(SOURCE_PATH)) {
    console.error(`❌ Source file not found: ${SOURCE_PATH}`);
    console.log('Please download it from https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.jsonl.gz and place it in the data/ directory.');
    process.exit(1);
  }

  // Initialize a new, clean database. This will delete any existing DB file.
  OpenFoodFactsDB.initialize();
  
  const db = new OpenFoodFactsDB({ readonly: false, fileMustExist: true });

  const { insert } = prepareStatements(db);

  const fileStream = fs.createReadStream(SOURCE_PATH);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let batch = [];
  let totalLines = 0;
  let importedCount = 0;
  const startTime = Date.now();

  console.log(`\n🚚 Starting import of ${SOURCE_PATH}...`);

  for await (const line of rl) {
    totalLines++;
    const product = transformProduct(line);

    if (product) {
      batch.push(product);
    }

    if (batch.length >= BATCH_SIZE) {
      insert(batch);
      importedCount += batch.length;
      batch = [];
    }

    if (totalLines % 100000 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = totalLines / elapsed;
      console.log(`- Processed ${totalLines.toLocaleString()} lines... (${rate.toFixed(0)} lines/sec)`);
    }
  }

  if (batch.length > 0) {
    insert(batch);
    importedCount += batch.length;
  }
  
  db.setMeta('last_full_import_date', new Date().toISOString());

  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000;

  console.log('\n✨ Import complete!');
  console.log('--------------------');
  console.log(`Total lines read: ${totalLines.toLocaleString()}`);
  console.log(`Products imported: ${importedCount.toLocaleString()}`);
  console.log(`Duration: ${duration.toFixed(2)} seconds`);

  console.log('\n🔧 Optimizing FTS index...');
  db.db.exec("INSERT INTO products_fts(products_fts) VALUES('rebuild');");
  console.log('✅ FTS index optimized.');
  
  console.log('\n🔍 Vacuuming database...');
  db.db.exec('VACUUM;');
  console.log('✅ Database vacuumed.');

  db.close();
  console.log(`\n🎉 Successfully created database at ${db.db.name}`);
}

runImport().catch((err) => {
  console.error('An unexpected error occurred:', err);
  process.exit(1);
}); 