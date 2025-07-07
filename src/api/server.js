/**
 * @fileoverview This is the main entry point for the API server.
 * It imports the Express app, starts the server, and handles graceful
 * shutdown procedures to ensure that the database connection and other
 * resources are closed properly.
 */
const { main, db } = require('./app');

const port = process.env.PORT || 3000;
let server;

async function startServer() {
  try {
    const app = await main(); // This initializes the db and returns the app
    server = app.listen(port, () => {
      console.log(`🚀 Server listening on port ${port}`);
      console.log('Semantic search API is available at /search/semantic/:term');
    });
  } catch (error) {
    console.error("Failed to start the server:", error);
    process.exit(1);
  }
}

/**
 * Handles graceful shutdown of the server.
 * It closes the HTTP server and the database connection before exiting.
 * This is crucial for preventing data corruption and ensuring a clean exit.
 */
function gracefulShutdown() {
  console.log('\nReceived signal to shut down. Closing server and database...');
  if (server) {
    server.close(() => {
      console.log('✅ Server has been shut down gracefully.');
      if (db) {
        db.close();
        console.log('✅ Database connection closed.');
      }
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

// Listen for termination signals
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

startServer();

module.exports = server; 