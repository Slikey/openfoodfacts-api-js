/**
 * @fileoverview This script handles the download and decompression of the
 * main OpenFoodFacts dataset. It fetches the full JSONL data dump,
 * decompresses it, and places it in the `data` directory, ready for import.
 *
 * @usage `node src/scripts/download.js`
 */
const fs = require('fs');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { SOURCE_PATH, DATA_DIR } = require('../db/constants');

const SOURCE_URL = 'https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz';

async function runDownload() {
  console.log(`🚀 Starting download of full dataset from ${SOURCE_URL}...`);
  console.log('This is a large file and may take some time.');

  if (!fs.existsSync(DATA_DIR)) {
    console.log(`Data directory not found at ${DATA_DIR}. Creating it...`);
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const compressedPath = `${SOURCE_PATH}.gz`;

  try {
    // 1. Download the compressed file
    console.log(`\n[1/3] Downloading to ${compressedPath}...`);
    const res = await fetch(SOURCE_URL);
    if (!res.ok) {
      throw new Error(`Failed to download: ${res.status} ${res.statusText}`);
    }
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(compressedPath));
    console.log('✅ Download complete.');

    // 2. Decompress the file
    console.log(`\n[2/3] Decompressing ${compressedPath} to ${SOURCE_PATH}...`);
    const gunzip = zlib.createGunzip();
    const source = fs.createReadStream(compressedPath);
    const destination = fs.createWriteStream(SOURCE_PATH);
    await pipeline(source, gunzip, destination);
    console.log('✅ Decompression complete.');

    // 3. Clean up the compressed file
    console.log(`\n[3/3] Cleaning up ${compressedPath}...`);
    fs.unlinkSync(compressedPath);
    console.log('✅ Cleanup complete.');

    console.log(`\n🎉 Successfully downloaded and decompressed the dataset.`);
    console.log(`You can now run 'npm run import' to build the database.`);

  } catch (error) {
    console.error('\n❌ An error occurred during the download process:', error);
    // Clean up partial files on error
    if (fs.existsSync(compressedPath)) {
      fs.unlinkSync(compressedPath);
    }
    if (fs.existsSync(SOURCE_PATH)) {
      fs.unlinkSync(SOURCE_PATH);
    }
    process.exit(1);
  }
}

runDownload(); 