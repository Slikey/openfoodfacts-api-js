# OpenFoodFacts-DB

A high-performance, self-hosted, read-only API for the entire OpenFoodFacts dataset, powered by Node.js and SQLite. This project provides a lightweight and extremely fast way to query product information locally, with a focus on quick startup times and efficient full-text search.

## Features

- **Blazing Fast Queries**: Utilizes SQLite with a memory-mapped, pre-indexed database for microsecond-level query times.
- **Efficient Full-Text Search**: Leverages SQLite's FTS5 extension for powerful and fast searching across product names, brands, categories, and more.
- **Read-Only API**: The runtime API is strictly read-only, ensuring stability, performance, and simplicity. All database writes happen in offline scripts.
- **Automatic Delta Updates**: Includes a script to fetch the latest daily delta files from OpenFoodFacts, keeping the local database up-to-date without requiring a full re-import.
- **Lightweight & Self-Contained**: No external database servers to manage. Everything runs in-process, making it easy to deploy and manage.
- **Well-Structured & Documented**: A clear separation between API, database, and script logic with comprehensive JSDoc comments.

## Core Philosophy

This project operates on a strict separation of two lifecycles:

1.  **Setup & Maintenance (Offline)**: These are scripts for building and updating the database. They handle downloading the raw data, creating the schema, transforming data, and populating the search index. These are resource-intensive operations designed to be run manually or via CI.
2.  **API Runtime (Online)**: This is the Express.js server that serves read-only queries. It's designed for maximum performance with an extremely fast startup time, as it assumes the database is already correctly built and indexed. The API server **never** modifies the database.

This separation ensures the API remains fast and reliable, offloading all heavy processing to background tasks.

## Project Structure

```
.
├── src/
│   ├── api/          # Express.js API runtime code
│   │   ├── app.js
│   │   └── server.js
│   ├── db/           # Shared database logic, constants, and data transformer
│   │   ├── constants.js
│   │   ├── database.js
│   │   └── transformer.js
│   └── scripts/      # Offline scripts for setup and maintenance
│       ├── benchmark.js
│       ├── download.js
│       ├── import.js
│       ├── rebuild-fts.js
│       └── update.js
├── data/             # (Created by setup) Holds the database and source files
└── package.json
```

## Getting Started

### Prerequisites

- Node.js (v16 or higher recommended)
- `npm` or a compatible package manager

### 1. Installation

Clone the repository and install the dependencies:

```bash
git clone <repository_url>
cd openfoodfacts-db
npm install
```

### 2. Initial Setup

Before you can run the API, you need to download the OpenFoodFacts dataset and build the local SQLite database.

**Step 1: Download the Dataset**
This script automatically downloads the latest OpenFoodFacts data dump (a large multi-gigabyte file), decompresses it, and places it in the `data/` directory.

```bash
npm run download
```

**Step 2: Run the Initial Import**
This script will build the `products.db` file from the downloaded data. This is a one-time process that can take a significant amount of time (15-30 minutes, depending on your machine).

```bash
npm run import
```

## Usage

### Running the API Server

Once the database has been created, you can start the API server:

```bash
npm run start
```

The server will be available at `http://localhost:3000`.

### API Endpoints

- **Health Check**
  - `GET /`
  - Confirms that the API is running.

- **Get Product by Barcode**
  - `GET /product/:code`
  - Retrieves a single product object by its unique barcode.
  - Example: `http://localhost:3000/product/3017620422003`

- **Search for Products**
  - `GET /search/:term`
  - Performs a full-text search for products.
  - Example: `http://localhost:3000/search/nutella`
  - **Query Parameters**:
    - `limit` (number, optional, default: 50): The maximum number of results to return.
    - `completeOnly` (boolean, optional, default: false): If `true`, only returns products with a high completeness score.

### Running Tests and Benchmarks

- **Run the test suite**:
  ```bash
  npm test
  ```
- **Run the performance benchmarks**:
  ```bash
  npm run benchmark
  ```

## Database Maintenance

### Updating with Latest Data

The `update` script fetches the latest daily changes from OpenFoodFacts and applies them to your database. It's fast and efficient, only processing files that are newer than your last update. Run it periodically to keep your data fresh.

```bash
npm run update
```

### Rebuilding the Search Index

If you ever need to manually rebuild the FTS5 search index (e.g., after changing the tokenizer configuration), you can use the `rebuild-fts` script. This is generally not needed during normal operation.

```bash
npm run rebuild-fts
```

## Benchmark Result

System used to generate the benchmark is a AMD 9950x3D with 64 GB of 6000 MHz DDR5 memory.

```
🔬 Benchmarking functions with database: C:\Users\kevin\Documents\Source\openfoodfacts-db\data\products.db
--------------------------------------------------
get(id) x 4,864 ops/sec ±1.06% (93 runs sampled)
search("Nutella") x 691 ops/sec ±1.23% (89 runs sampled)
search(barcode) x 86,690 ops/sec ±1.23% (89 runs sampled)
search("organic chicken broth") x 25.35 ops/sec ±0.89% (46 runs sampled)
search("organic chicken broth", { completeOnly: true }) x 26.50 ops/sec ±0.79% (48 runs sampled)
search(no results) x 90,876 ops/sec ±0.69% (97 runs sampled)
--------------------------------------------------
```

## License

This project is licensed under the MIT License. 