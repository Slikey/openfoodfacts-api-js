const path = require('path');
const Database = require('better-sqlite3');
const { DB_PATH } = require('./constants');

/**
 * Manages the connection to the SQLite database and provides methods for
 * data access and manipulation. It separates read-only and read-write
 * concerns, providing a fast, optimized path for the API and a setup
 * path for import/update scripts.
 */
class OpenFoodFactsDB {
  /**
   * Creates an instance of OpenFoodFactsDB.
   * The constructor is lightweight and suitable for both read-only and read-write operations.
   * @param {object} [options={}]
   * @param {boolean} [options.readonly=false] - Open the database in read-only mode.
   * @param {boolean} [options.fileMustExist=true] - Throw an error if the database file does not exist.
   */
  constructor(options = {}) {
    const { readonly = false, fileMustExist = true } = options;

    if (fileMustExist && !require('fs').existsSync(DB_PATH)) {
      throw new Error(`Database file not found at ${DB_PATH}. Please run the import script first.`);
    }

    this.db = new Database(DB_PATH, { readonly, fileMustExist });

    if (readonly) {
      // These PRAGMAs are for query performance and are only needed for the read-only API
      this.db.pragma('mmap_size = 30000000000');
      this.db.pragma('cache_size = -2000000');
    }

    this.db.pragma('journal_mode = WAL');
    this.prepareStatements();
  }

  /**
   * Initializes a new, empty database with the required schema.
   * This is a setup-time operation and should not be called at runtime.
   */
  static initialize() {
    const fs = require('fs');
    if (fs.existsSync(DB_PATH)) {
      // To prevent accidental overwrites, we could prompt the user
      // but for now, we'll just delete the old one to start fresh.
      fs.unlinkSync(DB_PATH);
    }
    
    const db = new Database(DB_PATH, { fileMustExist: false });
    db.pragma('journal_mode = WAL');
    
    db.exec(`
      CREATE TABLE meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      
      CREATE TABLE products (
        id TEXT PRIMARY KEY,
        code TEXT,
        product_name TEXT,
        brands TEXT,
        categories TEXT,
        countries TEXT,
        energy_kcal REAL,
        fat_100g REAL,
        saturated_fat_100g REAL,
        carbohydrates_100g REAL,
        sugars_100g REAL,
        proteins_100g REAL,
        salt_100g REAL,
        fiber_100g REAL,
        nutriscore_grade TEXT,
        nova_group INTEGER,
        ecoscore_grade TEXT,
        completeness REAL,
        complete_macros INTEGER,
        last_modified_t INTEGER,
        raw_data TEXT,
        search_text TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE VIRTUAL TABLE products_fts USING fts5(
        id,
        search_text,
        content='products',
        content_rowid='rowid'
      );
    `);
    
    db.close();
    console.log('Database initialized successfully.');
  }

  /**
   * Prepares all necessary SQL statements for reuse.
   * This is a critical performance optimization.
   */
  prepareStatements() {
    // Statement for getting a single product by its ID (barcode)
    this.stmtGet = this.db.prepare('SELECT * FROM products WHERE id = ?');

    // Statement for fast full-text search using the FTS5 index
    this.stmtSearch = this.db.prepare(`
      SELECT p.*
      FROM products_fts f
      JOIN products p ON p.rowid = f.rowid
      WHERE f.products_fts MATCH ?
      ORDER BY bm25(f.products_fts) -- Order by relevance using the BM25 algorithm
      LIMIT ?
    `);

    // Statement for FTS that only includes "complete" products
    this.stmtSearchComplete = this.db.prepare(`
      SELECT p.*
      FROM products_fts f
      JOIN products p ON p.rowid = f.rowid
      WHERE f.products_fts MATCH ? AND p.complete_macros = 1
      ORDER BY bm25(f.products_fts)
      LIMIT ?
    `);

    // Statements for metadata
    this.stmtGetMeta = this.db.prepare('SELECT value FROM meta WHERE key = ?');
    this.stmtSetMeta = this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  }

  /**
   * Retrieves a single product by its ID (which is the product's barcode).
   * @param {string} id The barcode of the product to retrieve.
   * @returns {object | undefined} The product object or undefined if not found.
   */
  get(id) {
    if (!id) return undefined;
    return this.stmtGet.get(id);
  }

  /**
   * Gets a value from the metadata table.
   * @param {string} key The key to look up.
   * @returns {string | undefined} The value or undefined if not found.
   */
  getMeta(key) {
    const row = this.stmtGetMeta.get(key);
    return row ? row.value : undefined;
  }
  
  /**
   * Sets a value in the metadata table.
   * @param {string} key The key to set.
   * @param {string|number} value The value to store.
   */
  setMeta(key, value) {
    this.stmtSetMeta.run(key, String(value));
  }

  /**
   * Performs a full-text search for products.
   * @param {string} term The search term. Can be a product name, brand, category, etc.
   * @param {object} [options={}] Search options.
   * @param {number} [options.limit=10] The maximum number of results to return.
   * @param {boolean} [options.completeOnly=true] Whether to only search for products with complete data.
   * @returns {Array<object>} An array of matching product objects.
   */
  search(term, options = {}) {
    if (!term || typeof term !== 'string' || term.trim() === '') {
      return [];
    }

    let { limit = 10, completeOnly = true } = options;
    limit = Math.min(Math.max(limit, 1), 100);

    // Sanitize and format the term for FTS5.
    // Each token is wrapped in double quotes to be treated as a literal,
    // preventing characters like '-' from being interpreted as operators.
    // A wildcard '*' is appended for prefix searching.
    const ftsTerm = term
      .split(/\s+/)
      .filter(t => t)
      .map(t => `"${t.replace(/"/g, '""')}"*`)
      .join(' ');

    const statement = completeOnly ? this.stmtSearchComplete : this.stmtSearch;
    return statement.all(ftsTerm, limit);
  }

  /**
   * Closes the database connection. Should be called on graceful shutdown.
   */
  close() {
    this.db.close();
  }
}

module.exports = OpenFoodFactsDB; 