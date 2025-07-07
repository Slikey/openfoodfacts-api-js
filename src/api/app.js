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
  const completeOnly = req.query.completeOnly ? req.query.completeOnly === 'true' : true;
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
 * @api {get} / Health Check & Live Search UI
 * @apiName HealthCheck
 * @apiGroup System
 *
 * @apiSuccess {String} HTML The live search interface.
 */
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenFoodFacts Live Search</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 2rem auto; padding: 0 1rem; background-color: #f8f9fa; }
    h1 { color: #007bff; text-align: center; }
    #search-box { width: 100%; padding: 0.75rem; font-size: 1.2rem; border-radius: 8px; border: 1px solid #ced4da; box-sizing: border-box; }
    #results { margin-top: 1.5rem; }
    .product { background-color: #fff; border: 1px solid #dee2e6; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; box-shadow: 0 2px 4px rgba(0,0,0,0.05); transition: box-shadow 0.2s ease-in-out; }
    .product:hover { box-shadow: 0 4px 8px rgba(0,0,0,0.1); }
    .product-header { display: flex; justify-content: space-between; align-items: flex-start; }
    .product-name { font-size: 1.1rem; font-weight: bold; margin: 0; }
    .product-brands { font-size: 0.9rem; color: #6c757d; margin: 0; }
    .macros { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 0.75rem; margin-top: 1rem; border-top: 1px solid #eee; padding-top: 1rem; }
    .macro { background-color: #f8f9fa; padding: 0.5rem; border-radius: 5px; text-align: center; }
    .macro-label { font-size: 0.8rem; color: #495057; display: block; }
    .macro-value { font-size: 1rem; font-weight: 600; }
    #status { text-align: center; color: #6c757d; padding: 2rem; }
  </style>
</head>
<body>
  <h1>OpenFoodFacts Live Search</h1>
  <input type="text" id="search-box" placeholder="Search for a product (e.g., Nutella)..." autofocus>
  <div id="status"><p>Start typing to see results</p></div>
  <div id="results"></div>

  <script>
    const searchBox = document.getElementById('search-box');
    const resultsContainer = document.getElementById('results');
    const statusContainer = document.getElementById('status');
    let debounceTimer;

    searchBox.addEventListener('input', (e) => {
      const searchTerm = e.target.value.trim();
      statusContainer.style.display = 'block';

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (searchTerm) {
          statusContainer.innerHTML = '<p>Searching...</p>';
          performSearch(searchTerm);
        } else {
          resultsContainer.innerHTML = '';
          statusContainer.innerHTML = '<p>Start typing to see results</p>';
        }
      }, 250); // Debounce for 250ms
    });

    async function performSearch(term) {
      try {
        const response = await fetch(\`/search/\${encodeURIComponent(term)}?limit=20\`);
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        const products = await response.json();
        displayResults(products);
      } catch (error) {
        console.error('Search error:', error);
        statusContainer.innerHTML = '<p style="color: red;">Error performing search.</p>';
        resultsContainer.innerHTML = '';
      }
    }

    function displayResults(products) {
      resultsContainer.innerHTML = '';
      if (products.length === 0) {
        statusContainer.innerHTML = '<p>No products found.</p>';
        return;
      }
      
      statusContainer.style.display = 'none';

      products.forEach(product => {
        const productElement = document.createElement('div');
        productElement.className = 'product';

        const macros = [
          { label: 'Calories', value: product.energy_kcal, unit: 'kcal' },
          { label: 'Protein', value: product.proteins_100g, unit: 'g' },
          { label: 'Carbs', value: product.carbohydrates_100g, unit: 'g' },
          { label: 'Fat', value: product.fat_100g, unit: 'g' }
        ];

        productElement.innerHTML = \`
          <div class="product-header">
            <div>
              <p class="product-name">\${product.product_name || 'N/A'}</p>
              <p class="product-brands">\${product.brands || 'Unknown Brand'}</p>
            </div>
          </div>
          <div class="macros">
            \${macros.map(macro => \`
              <div class="macro">
                <span class="macro-label">\${macro.label}</span>
                <span class="macro-value">\${typeof macro.value === 'number' ? macro.value.toFixed(1) : 'N/A'} \${macro.unit}</span>
              </div>
            \`).join('')}
          </div>
        \`;
        resultsContainer.appendChild(productElement);
      });
    }
  </script>
</body>
</html>
  `);
});

module.exports = { app, db }; 