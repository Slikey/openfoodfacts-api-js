const path = require('path');

const DB_FILENAME = 'products.db';
const SOURCE_FILENAME = 'openfoodfacts-products.jsonl';
const DATA_DIR = path.join(process.cwd(), 'data');

module.exports = {
  DB_FILENAME,
  SOURCE_FILENAME,
  DATA_DIR,
  DB_PATH: path.join(DATA_DIR, DB_FILENAME),
  SOURCE_PATH: path.join(DATA_DIR, SOURCE_FILENAME),
  DELTA_URL: 'https://static.openfoodfacts.org/data/delta/',
  DELTA_INDEX_URL: 'https://static.openfoodfacts.org/data/delta/index.txt',
}; 