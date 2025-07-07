/**
 * @fileoverview This script handles the delta update process for the
 * OpenFoodFacts database. It fetches the latest delta files from the
 * OpenFoodFacts server, processes them, and upserts the product data
 * into the local SQLite database.
 *
 * It tracks the last applied delta file using a timestamp in the `meta`
 * table to ensure it only processes new updates.
 *
 * @usage `node src/scripts/update.js`
 */
const fs = require('fs');
const readline = require('readline');
const zlib = require('zlib');
const path = require('path');
const { DELTA_URL, DELTA_INDEX_URL, DATA_DIR } = require('../db/constants');
const OpenFoodFactsDB = require('../db/database');
const { transformProduct } = require('../db/transformer');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const BATCH_SIZE = 1000;
const LAST_DELTA_KEY = 'last_applied_delta_timestamp';

/**
 * Downloads a file from a given URL to a local destination.
 * @param {string} url - The URL of the file to download.
 * @param {string} dest - The local path to save the file.
 */
async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.statusText}`);
  }
  const fileStream = fs.createWriteStream(dest);
  await pipeline(Readable.fromWeb(res.body), fileStream);
}

/**
 * Prepares the database statements for batch upserting.
 * Using `INSERT OR REPLACE` handles both new products and updates to existing ones.
 * A transaction is used for performance.
 * @param {OpenFoodFactsDB} db - The database instance.
 * @returns {{upsert: Function}} An object with an `upsert` function.
 */
function prepareStatements(db) {
  const upsertStmt = db.db.prepare(`
    INSERT OR REPLACE INTO products (
      id, code, product_name, brands, categories, countries, energy_kcal, fat_100g,
      saturated_fat_100g, carbohydrates_100g, sugars_100g, proteins_100g, salt_100g,
      fiber_100g, nutriscore_grade, nova_group, ecoscore_grade, completeness,
      last_modified_t, raw_data, search_text, updated_at
    ) VALUES (
      @id, @code, @product_name, @brands, @categories, @countries, @energy_kcal, @fat_100g,
      @saturated_fat_100g, @carbohydrates_100g, @sugars_100g, @proteins_100g, @salt_100g,
      @fiber_100g, @nutriscore_grade, @nova_group, @ecoscore_grade, @completeness,
      @last_modified_t, @raw_data, @search_text, CURRENT_TIMESTAMP
    )
  `);

  return {
    upsert: db.db.transaction((batch) => {
      for (const product of batch) {
        upsertStmt.run(product);
      }
    }),
  };
}

/**
 * Processes a single compressed delta file.
 * It downloads, decompresses, and reads the file line by line,
 * transforming and upserting each product in batches.
 * @param {OpenFoodFactsDB} db - The database instance.
 * @param {object} stmts - The prepared statements object.
 * @param {string} deltaFilename - The filename of the delta to process.
 */
async function processDeltaFile(db, stmts, deltaFilename) {
  console.log(`  - Processing ${deltaFilename}...`);
  const deltaUrl = `${DELTA_URL}${deltaFilename}`;
  const localPath = path.join(DATA_DIR, deltaFilename);
  const localJsonlPath = localPath.replace('.gz', '');

  try {
    await downloadFile(deltaUrl, localPath);

    // Decompress
    await new Promise((resolve, reject) => {
      const gunzip = zlib.createGunzip();
      const source = fs.createReadStream(localPath);
      const destination = fs.createWriteStream(localJsonlPath);
      source.pipe(gunzip).pipe(destination).on('finish', resolve).on('error', reject);
    });
    
    const fileStream = fs.createReadStream(localJsonlPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let batch = [];
    let processedCount = 0;
    for await (const line of rl) {
      const product = transformProduct(line);
      if (product) {
        batch.push(product);
      }
      if (batch.length >= BATCH_SIZE) {
        stmts.upsert(batch);
        processedCount += batch.length;
        batch = [];
      }
    }

    if (batch.length > 0) {
      stmts.upsert(batch);
      processedCount += batch.length;
    }
    
    console.log(`    ...upserted ${processedCount} products.`);
  } finally {
    // Cleanup local files
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
    if (fs.existsSync(localJsonlPath)) fs.unlinkSync(localJsonlPath);
  }
}

/**
 * Main function to execute the delta update process.
 * It determines which delta files are new, processes them in order,
 * and updates the last-applied timestamp in the database.
 */
async function runUpdate() {
  const db = new OpenFoodFactsDB({ readonly: false, fileMustExist: true });
  
  try {
    console.log('🚀 Starting delta update process...');
    
    const lastTimestamp = parseInt(db.getMeta(LAST_DELTA_KEY) || '0', 10);
    console.log(`Last update timestamp: ${lastTimestamp || 'Never (full import needed)'}`);
    
    console.log('Downloading delta index file...');
    const indexFilePath = path.join(DATA_DIR, 'index.txt');
    await downloadFile(DELTA_INDEX_URL, indexFilePath);
    
    const indexContent = fs.readFileSync(indexFilePath, 'utf-8');
    fs.unlinkSync(indexFilePath); // Clean up index file right away
    const allDeltas = indexContent.split('\n').filter(f => f.endsWith('.json.gz'));
    
    const newDeltas = allDeltas
      .map(filename => {
        const match = filename.match(/_(\d+)_(\d+)\.json\.gz$/);
        return match ? { filename, start: parseInt(match[1]), end: parseInt(match[2]) } : null;
      })
      .filter(d => d && d.end > lastTimestamp)
      .sort((a, b) => a.end - b.end);

    if (newDeltas.length === 0) {
      console.log('✅ Database is already up-to-date.');
      return;
    }
    
    console.log(`Found ${newDeltas.length} new delta file(s) to apply.`);
    
    const stmts = prepareStatements(db);
    let latestProcessedTimestamp = lastTimestamp;

    for (const delta of newDeltas) {
      await processDeltaFile(db, stmts, delta.filename);
      latestProcessedTimestamp = delta.end;
      db.setMeta(LAST_DELTA_KEY, latestProcessedTimestamp.toString());
      console.log(`  ...updated last delta timestamp to ${latestProcessedTimestamp}`);
    }
    
    console.log('\n✨ Delta update complete!');
    console.log(`Database is now up-to-date as of timestamp: ${latestProcessedTimestamp}`);
    
  } finally {
    db.close();
  }
}

runUpdate().catch((err) => {
  console.error('\n❌ An unexpected error occurred during the update process:', err);
  process.exit(1);
}); 