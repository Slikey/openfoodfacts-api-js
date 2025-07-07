/**
 * @fileoverview This is the main entry point for the API server.
 * It imports the Express app, starts the server, and handles graceful
 * shutdown procedures to ensure that the database connection and other
 * resources are closed properly.
 */
const { app, db } = require('./app');

const port = process.env.PORT || 3000;

const server = app.listen(port, () => {
  console.log(`🚀 Server listening on port ${port}`);
});

/**
 * Handles graceful shutdown of the server.
 * It closes the HTTP server and the database connection before exiting.
 * This is crucial for preventing data corruption and ensuring a clean exit.
 */
function gracefulShutdown() {
  console.log('\nReceived signal to shut down. Closing server and database...');
  server.close(() => {
    console.log('✅ Server has been shut down gracefully.');
    db.close();
    console.log('✅ Database connection closed.');
    process.exit(0);
  });
}

// Listen for termination signals
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

module.exports = server; 