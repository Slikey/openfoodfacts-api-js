const Benchmark = require('benchmark');
const OpenFoodFactsDB = require('../db/database');

function runBenchmarks() {
  console.log('🚀 Initializing benchmark suite...');
  
  let db;
  try {
    db = new OpenFoodFactsDB();
  } catch (error) {
    console.error('❌ Benchmark setup failed: Could not connect to the database.');
    console.error(error.message);
    process.exit(1);
  }

  const suite = new Benchmark.Suite;
  const knownId = '3017620422003'; // Nutella barcode

  console.log(`\n🔬 Benchmarking functions with database: ${db.db.name}`);
  console.log('--------------------------------------------------');

  suite
    .add('get(id)', () => {
      db.get(knownId);
    })
    .add('search("Nutella")', () => {
      db.search('Nutella');
    })
    .add('search(barcode)', () => {
      db.search(knownId);
    })
    .add('search("organic chicken broth")', () => {
      db.search('organic chicken broth');
    })
    .add('search("organic chicken broth", { completeOnly: true })', () => {
      db.search('organic chicken broth', { completeOnly: true });
    })
    .add('search(no results)', () => {
      db.search('asdfghjklqwertyuiopzxcvbnm');
    })
    .on('cycle', (event) => {
      console.log(String(event.target));
    })
    .on('complete', function () {
      console.log('--------------------------------------------------');
      db.close();
      console.log('\nBenchmarks complete. Database connection closed.');
    })
    .on('error', (err) => {
      console.error('An error occurred during benchmarking:', err);
      db.close();
    })
    .run({ 'async': false });
}

runBenchmarks(); 