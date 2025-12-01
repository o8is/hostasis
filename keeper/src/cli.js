#!/usr/bin/env node

/**
 * Hostasis Keeper CLI
 *
 * Command-line interface for running and managing the keeper bot
 */

const HostasisKeeper = require('./keeper');

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];

// Load configuration from environment variables with sensible defaults
const config = {
  rpcUrl: process.env.KEEPER_RPC_URL || 'https://rpc.gnosischain.com',
  managerAddress: process.env.KEEPER_MANAGER_ADDRESS || '',
  privateKey: process.env.KEEPER_PRIVATE_KEY || '',
  harvestCheckInterval: parseInt(process.env.KEEPER_HARVEST_INTERVAL || '300000', 10),
  batchCheckInterval: parseInt(process.env.KEEPER_BATCH_INTERVAL || '60000', 10),
  batchSize: parseInt(process.env.KEEPER_BATCH_SIZE || '20', 10),
  harvestGasEstimate: parseInt(process.env.KEEPER_HARVEST_GAS || '370000', 10),
  batchGasEstimate: parseInt(process.env.KEEPER_BATCH_GAS || '1135000', 10),
  unwrapGasEstimate: parseInt(process.env.KEEPER_UNWRAP_GAS || '35000', 10),
  minProfitMarginPercent: parseInt(process.env.KEEPER_MIN_PROFIT_MARGIN || '1', 10)
};

// Validate required configuration
if (!config.managerAddress) {
  console.error('Error: KEEPER_MANAGER_ADDRESS environment variable is required');
  console.error('Set it to your deployed PostageYieldManager contract address');
  process.exit(1);
}

if (!config.privateKey) {
  console.error('Error: KEEPER_PRIVATE_KEY environment variable is required');
  console.error('Set it to your keeper wallet private key (needs xDAI for gas)');
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

Configuration (Environment Variables):
  Required:
    KEEPER_MANAGER_ADDRESS    Address of deployed PostageYieldManager contract
    KEEPER_PRIVATE_KEY        Private key of keeper wallet (needs xDAI for gas)

  Optional (with defaults):
    KEEPER_RPC_URL            Gnosis Chain RPC endpoint (default: https://rpc.gnosischain.com)
    KEEPER_HARVEST_INTERVAL   How often to check for harvest opportunities in ms (default: 300000)
    KEEPER_BATCH_INTERVAL     How often to check for batch processing in ms (default: 60000)
    KEEPER_BATCH_SIZE         Number of users to process per batch (default: 20)
    KEEPER_HARVEST_GAS        Estimated gas for harvest operation (default: 370000)
    KEEPER_BATCH_GAS          Estimated gas for batch processing (default: 1135000)
    KEEPER_UNWRAP_GAS         Estimated gas for wxDAI unwrap operation (default: 35000)
    KEEPER_MIN_PROFIT_MARGIN  Minimum profit margin above gas costs in percent (default: 1)

Example:
  export KEEPER_MANAGER_ADDRESS=0x1234...
  export KEEPER_PRIVATE_KEY=0xabcd...
  node cli.js start

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
