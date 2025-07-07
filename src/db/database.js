const Database = require('better-sqlite3');
const { DB_PATH } = require('./constants');
const { transformProduct } = require('./transformer');
const sqliteVec = require('sqlite-vec');
const { pipeline, cos_sim } = require('@xenova/transformers');

/**
 * A singleton class to manage the sentence-transformer pipeline.
 * Ensures the model is loaded only once.
 */
class PipelineSingleton {
    static task = 'feature-extraction';
    static model = 'Xenova/all-MiniLM-L6-v2';
    static instance = null;

    static async getInstance(progress_callback = null) {
        if (this.instance === null) {
            console.log('Loading sentence-transformer model for the first time...');
            this.instance = pipeline(this.task, this.model, { progress_callback });
        }
        return this.instance;
    }
}

class OpenFoodFactsDB {
    constructor(db, embedder) {
        if (!db) {
            throw new Error("Database connection not provided.");
        }
        if (!embedder) {
            throw new Error("Embedder pipeline not provided.");
        }
        this.db = db;
        this.embedder = embedder;
        console.log('Database and embedder are ready. Preparing statements...');
        this.db.pragma('journal_mode = WAL');
        this.prepareStatements();
        console.log('Statements prepared.');
    }

    /**
     * Asynchronously creates and initializes an instance of OpenFoodFactsDB.
     * This is the correct way to instantiate this class.
     */
    static async create(options = {}) {
        console.log('Initializing OpenFoodFactsDB...');
        const { dbPath = DB_PATH, readonly = true } = options;
        const dbOptions = { readonly, fileMustExist: true };
        
        const db = new Database(dbPath, dbOptions);
        console.log('Database file opened.');
        
        // Load the sqlite-vec extension
        sqliteVec.load(db);
        console.log('sqlite-vec extension loaded.');

        // Load the sentence-transformer model
        const embedder = await PipelineSingleton.getInstance();
        console.log('Sentence-transformer model loaded.');

        return new OpenFoodFactsDB(db, embedder);
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
        this.stmtGet = this.db.prepare('SELECT * FROM products WHERE id = ?');
        this.stmtSearch = this.db.prepare(`
            SELECT p.*, fts.rank
            FROM products_fts fts
            JOIN products p ON p.id = fts.id
            WHERE fts.products_fts MATCH ?
            ORDER BY fts.rank
            LIMIT ?
        `);

        // New statement for semantic search
        this.stmtSemanticSearch = this.db.prepare(`
            SELECT
                p.*,
                nn.distance
            FROM (
                SELECT rowid, distance FROM vec_products
                WHERE embedding MATCH ?
                ORDER BY distance
                LIMIT ?
            ) AS nn
            JOIN products p ON p.rowid = nn.rowid
            ORDER BY nn.distance
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
    get(code) {
        if (!code) return undefined;
        const product = this.stmtGet.get(code);
        return product || null;
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
        const rows = statement.all(ftsTerm, limit);
        return rows;
    }

    /**
     * Performs a semantic vector search for products.
     * @param {string} term The search term.
     * @param {object} options Search options, e.g., { limit: 10 }.
     * @returns {Promise<Array<object>>} A promise that resolves to an array of product objects.
     */
    async semanticSearch(term, options = {}) {
        if (!term || typeof term !== 'string' || term.trim() === '') {
            return [];
        }

        const { limit = 10 } = options;
        
        console.log(`Performing semantic search for: "${term}" with limit ${limit}`);

        // 1. Generate the embedding for the search term
        console.time('embedding_generation');
        const queryEmbedding = await this.embedder(term, {
            pooling: 'mean',
            normalize: true,
        });
        console.timeEnd('embedding_generation');

        // 2. Convert the embedding to a Buffer for the query
        const queryVector = new Float32Array(queryEmbedding.data);
        const queryVectorBuffer = Buffer.from(queryVector.buffer);

        // 3. Query the database
        console.time('db_query');
        const rows = this.stmtSemanticSearch.all(queryVectorBuffer, limit);
        console.timeEnd('db_query');
        
        console.log(`Found ${rows.length} results from semantic search.`);
        
        return rows;
    }

    /**
     * Closes the database connection. Should be called on graceful shutdown.
     */
    close() {
        this.db.close();
    }
}

module.exports = OpenFoodFactsDB;