#!/usr/bin/env node

/**
 * Hostasis Keeper CLI
 *
 * Command-line interface for running and managing the keeper bot
 */

const HostasisKeeper = require('./keeper');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];

// Load config
let config;
try {
  const configPath = path.join(__dirname, '../config/config.json');
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
  console.error('Error loading config.json:', error.message);
  console.error('\nPlease create config/config.json based on config.example.json');
  process.exit(1);
}

// Validate config
if (!config.managerAddress || config.managerAddress === 'YOUR_DEPLOYED_MANAGER_ADDRESS') {
  console.error('Error: managerAddress not configured in config.json');
  process.exit(1);
}

if (!config.privateKey || config.privateKey === 'YOUR_KEEPER_PRIVATE_KEY') {
  console.error('Error: privateKey not configured in config.json');
  console.error('WARNING: Never commit your private key to git!');
  process.exit(1);
}

// Initialize keeper
const keeper = new HostasisKeeper(config);

// Handle commands
async function main() {
  switch (command) {
    case 'start':
      console.log('Starting Hostasis Keeper Bot...\n');
      await keeper.start();

      // Print initial status
      await keeper.printStatus();

      // Print status every 5 minutes
      setInterval(async () => {
        await keeper.printStatus();
      }, 300000);

      // Handle graceful shutdown
      process.on('SIGINT', () => {
        console.log('\nReceived SIGINT, shutting down gracefully...');
        keeper.stop();
        process.exit(0);
      });

      process.on('SIGTERM', () => {
        console.log('\nReceived SIGTERM, shutting down gracefully...');
        keeper.stop();
        process.exit(0);
      });
      break;

    case 'status':
      await keeper.printStatus();
      process.exit(0);
      break;

    case 'harvest':
      console.log('Manually triggering harvest check...\n');
      await keeper.checkAndHarvest();
      process.exit(0);
      break;

    case 'process':
      console.log('Manually triggering batch processing...\n');
      await keeper.checkAndProcessBatches();
      process.exit(0);
      break;

    case 'once':
      console.log('Running keeper once (harvest + process batches)...\n');
      await keeper.checkAndHarvest();
      await keeper.checkAndProcessBatches();
      await keeper.printStatus();
      process.exit(0);
      break;

    case 'help':
    default:
      console.log(`
Hostasis Keeper Bot CLI

Usage:
  node cli.js <command>

Commands:
  start       Start the keeper bot (runs continuously)
  status      Check current status
  harvest     Manually check and execute harvest if profitable
  process     Manually check and process batches if profitable
  once        Run harvest and batch processing once, then exit
  help        Show this help message

Examples:
  node cli.js start          # Run keeper bot continuously
  node cli.js status         # Check current system status
  node cli.js once           # One-time harvest and process

Configuration:
  Edit config/config.json to configure RPC URL, contract address,
  private key, and other parameters.

  See config/config.example.json for reference.

Environment:
  You can also use environment variables to override config:
    KEEPER_RPC_URL
    KEEPER_MANAGER_ADDRESS
    KEEPER_PRIVATE_KEY

Press Ctrl+C to stop the keeper bot gracefully.
      `);
      process.exit(0);
  }
}

// Run
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
