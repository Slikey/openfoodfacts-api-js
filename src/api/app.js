/**
 * @fileoverview This file defines the Express application.
 * It sets up the database connection, configures middleware (CORS, JSON parsing, logging),
 * and defines the API routes for serving product data. The `app` and `db`
 * instances are exported for use in the server and test files.
 */
const express = require('express');
const cors = require('cors');
const OpenFoodFactsDB = require('../db/database');
const { performance } = require('perf_hooks');

const app = express();

/**
 * @type {OpenFoodFactsDB}
 * The database instance used by the application.
 * It's opened in read-only mode for safety and performance.
 */
let db;
try {
  db = new OpenFoodFactsDB({ readonly: true });
} catch (error) {
  console.error("Failed to initialize the database. Ensure 'products.db' exists and is valid.");
  console.error(error.message);
  process.exit(1);
}

// Middleware
/**
 * Log incoming requests and their response times.
 */
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  const start = performance.now();
  res.on('finish', () => {
    const duration = performance.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${res.statusCode} [${duration.toFixed(2)}ms]`);
  });
  next();
});

// Routes
/**
 * @api {get} /product/:code Get Product by Barcode
 * @apiName GetProduct
 * @apiGroup Product
 *
 * @apiParam {String} code Product's unique barcode.
 *
 * @apiSuccess {Object} product The full product object.
 * @apiError (404) ProductNotFound The product with the given code was not found.
 */
app.get('/product/:code', (req, res) => {
  const { code } = req.params;
  if (!code) {
    return res.status(400).json({ error: 'Product code is required' });
  }

  try {
    const product = db.get(code);
    if (product) {
      res.json(product);
    } else {
      res.status(404).json({ error: 'Product not found' });
    }
  } catch (error) {
    console.error(`Error fetching product with code ${code}:`, error);
    res.status(500).json({ error: 'An error occurred while fetching the product.' });
  }
});

/**
 * @api {get} /search/:term Search for Products
 * @apiName SearchProducts
 * @apiGroup Product
 *
 * @apiParam {String} term The search term.
 * @apiQuery {Number{1-100}} [limit=50] The maximum number of results to return.
 * @apiQuery {Boolean} [completeOnly=false] Whether to only return products with complete data.
 *
 * @apiSuccess {Object[]} products An array of matching product objects.
 */
app.get('/search/:term', (req, res) => {
  const { term } = req.params;
  const completeOnly = req.query.completeOnly ? req.query.completeOnly === 'true' : false;
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;

  if (!term) {
    return res.status(400).json({ error: 'Search term is required' });
  }

  if (isNaN(limit) || limit <= 0 || limit > 100) {
    return res.status(400).json({ error: 'Invalid limit parameter. Must be a positive integer <= 100.' });
  }

  try {
    const results = db.search(term, { limit, completeOnly });
    res.json(results);
  } catch (error) {
    console.error(`Error during search for term "${term}":`, error);
    res.status(500).json({ error: 'An error occurred during the search.' });
  }
});

/**
 * @api {get} / Health Check
 * @apiName HealthCheck
 * @apiGroup System
 *
 * @apiSuccess {String} message A confirmation that the API is running.
 */
app.get('/', (req, res) => {
  res.send('OpenFoodFacts DB API is running.');
});

module.exports = { app, db }; 