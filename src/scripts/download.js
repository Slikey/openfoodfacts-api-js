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
const { Readable, Transform } = require('stream');
const { SOURCE_PATH, DATA_DIR } = require('../db/constants');
const path = require('path');
const { DownloaderHelper } = require('node-downloader-helper');

const SOURCE_URL = 'https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz';

async function runDownload() {
  // Ensure the data directory exists
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const stats = fs.statSync(DATA_DIR, { throwIfNoEntry: false });
  const lastModifiedTime = stats ? stats.mtime.toISOString() : null;

  console.log(`🚀 Starting download of full dataset from ${SOURCE_URL}...`);
  console.log('This is a large file and may take some time.');

  const compressedPath = `${SOURCE_PATH}.gz`;

  try {
    // 1. Download the compressed file
    console.log(`\n[1/3] Downloading to ${compressedPath}...`);
    const res = await fetch(SOURCE_URL);
    if (!res.ok) {
      throw new Error(`Failed to download: ${res.status} ${res.statusText}`);
    }

    const totalSize = parseInt(res.headers.get('content-length'), 10);
    let downloadedSize = 0;
    const progressStream = new Transform({
      transform(chunk, encoding, callback) {
        downloadedSize += chunk.length;
        if (totalSize) {
          const percentage = Math.floor((downloadedSize / totalSize) * 100);
          process.stdout.write(`Downloading... ${percentage}% (${(downloadedSize / 1024 / 1024).toFixed(2)}MB / ${(totalSize / 1024 / 1024).toFixed(2)}MB)\r`);
        } else {
          process.stdout.write(`Downloading... ${(downloadedSize / 1024 / 1024).toFixed(2)}MB\r`);
        }
        this.push(chunk);
        callback();
      }
    });

    await pipeline(Readable.fromWeb(res.body), progressStream, fs.createWriteStream(compressedPath));
    process.stdout.write('\n');
    console.log('✅ Download complete.');

    // 2. Decompress the file
    console.log(`\n[2/3] Decompressing ${compressedPath} to ${SOURCE_PATH}...`);
    const gunzip = zlib.createGunzip();
    const source = fs.createReadStream(compressedPath);
    const destination = fs.createWriteStream(SOURCE_PATH);

    const compressedFileSize = fs.statSync(compressedPath).size;
    let readSize = 0;
    source.on('data', (chunk) => {
      readSize += chunk.length;
      const percentage = Math.floor((readSize / compressedFileSize) * 100);
      process.stdout.write(`Decompressing... ${percentage}%\r`);
    });

    await pipeline(source, gunzip, destination);
    process.stdout.write('\n');
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