/**
 * Hostasis Keeper Bot
 *
 * Automated keeper that:
 * 1. Monitors yield accumulation and calls harvest() when profitable
 * 2. Processes batch distributions to earn keeper fees
 * 3. Manages gas costs vs rewards to ensure profitability
 */

const { ethers } = require('ethers');
const config = require('../config/config.json');

// Contract ABI (minimal - only what we need)
const MANAGER_ABI = [
  'function previewYield() external view returns (uint256)',
  'function minYieldThreshold() external view returns (uint256)',
  'function harvest() external',
  'function processBatch(uint256 batchSize) external',
  'function getBatchIncentive(uint256 batchSize) external view returns (bool canProcess, uint256 estimatedReward, uint256 remainingUsers)',
  'function distributionState() external view returns (uint256 totalBZZ, uint256 cursor, uint256 snapshotTotalSDAI, bool active)',
  'function keeperFeePool() external view returns (uint256)',
  'function harvesterFeeBps() external view returns (uint256)'
];

class HostasisKeeper {
  constructor(configOverrides = {}) {
    this.config = { ...config, ...configOverrides };
    this.isRunning = false;
    this.processingBatch = false;
    this.harvesting = false;

    // Setup provider and wallet
    this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
    this.wallet = new ethers.Wallet(this.config.privateKey, this.provider);

    // Setup contract
    this.manager = new ethers.Contract(
      this.config.managerAddress,
      MANAGER_ABI,
      this.wallet
    );

    console.log(`Keeper initialized with address: ${this.wallet.address}`);
  }

  /**
   * Start the keeper bot
   */
  async start() {
    console.log('Starting Hostasis Keeper Bot...');
    this.isRunning = true;

    // Initial check
    await this.checkAndHarvest();
    await this.checkAndProcessBatches();

    // Set up monitoring intervals
    this.harvestInterval = setInterval(
      () => this.checkAndHarvest(),
      this.config.harvestCheckInterval
    );

    this.batchInterval = setInterval(
      () => this.checkAndProcessBatches(),
      this.config.batchCheckInterval
    );

    console.log('Keeper bot running...');
    console.log(`Harvest checks every ${this.config.harvestCheckInterval / 1000}s`);
    console.log(`Batch checks every ${this.config.batchCheckInterval / 1000}s`);
  }

  /**
   * Stop the keeper bot
   */
  stop() {
    console.log('Stopping keeper bot...');
    this.isRunning = false;

    if (this.harvestInterval) clearInterval(this.harvestInterval);
    if (this.batchInterval) clearInterval(this.batchInterval);

    console.log('Keeper bot stopped.');
  }

  /**
   * Check if harvest is profitable and execute
   */
  async checkAndHarvest() {
    if (this.harvesting) {
      console.log('Harvest already in progress, skipping...');
      return;
    }

    try {
      // Check if there's already an active distribution
      const distState = await this.manager.distributionState();
      if (distState.active) {
        console.log('Distribution already active, skipping harvest check');
        return;
      }

      // Get current yield
      const yieldAvailable = await this.manager.previewYield();
      const minThreshold = await this.manager.minYieldThreshold();

      console.log(`Yield available: ${ethers.formatEther(yieldAvailable)} DAI`);
      console.log(`Min threshold: ${ethers.formatEther(minThreshold)} DAI`);

      // Check if yield meets minimum threshold
      if (yieldAvailable < minThreshold) {
        console.log('Yield below threshold, skipping harvest');
        return;
      }

      // Calculate expected harvester fee (we get this!)
      const harvesterFeeBps = await this.manager.harvesterFeeBps();
      const harvesterFee = (yieldAvailable * harvesterFeeBps) / 10000n;

      console.log(`Expected harvester fee: ${ethers.formatEther(harvesterFee)} DAI`);

      // Estimate gas cost
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice;
      const estimatedGas = this.config.harvestGasEstimate;
      const gasCostWei = gasPrice * BigInt(estimatedGas);

      // Convert gas cost from xDAI to DAI equivalent (1:1 on Gnosis)
      const gasCostDAI = gasCostWei;

      console.log(`Estimated gas cost: ${ethers.formatEther(gasCostDAI)} DAI`);
      console.log(`Net profit: ${ethers.formatEther(harvesterFee - gasCostDAI)} DAI`);

      // Check profitability with configured profit margin
      const minProfit = gasCostDAI * BigInt(this.config.minProfitMarginPercent) / 100n;
      if (harvesterFee < gasCostDAI + minProfit) {
        console.log('Harvest not profitable yet, waiting...');
        return;
      }

      // Execute harvest
      console.log('Executing harvest...');
      this.harvesting = true;

      const tx = await this.manager.harvest({
        gasLimit: estimatedGas
      });

      console.log(`Harvest transaction sent: ${tx.hash}`);
      const receipt = await tx.wait();

      console.log(`Harvest successful! Gas used: ${receipt.gasUsed.toString()}`);
      console.log(`Harvester fee earned: ${ethers.formatEther(harvesterFee)} DAI`);

      this.harvesting = false;

      // Immediately check for batch processing
      await this.checkAndProcessBatches();

    } catch (error) {
      this.harvesting = false;
      console.error('Error during harvest check:', error.message);

      // Log more details for transaction errors
      if (error.transaction) {
        console.error('Transaction details:', error.transaction);
      }
    }
  }

  /**
   * Check if batch processing is profitable and execute
   */
  async checkAndProcessBatches() {
    if (this.processingBatch) {
      console.log('Batch processing already in progress, skipping...');
      return;
    }

    try {
      // Check if distribution is active
      const distState = await this.manager.distributionState();
      if (!distState.active) {
        // No distribution active
        return;
      }

      // Check keeper fee pool
      const keeperFeePool = await this.manager.keeperFeePool();
      if (keeperFeePool === 0n) {
        console.log('No keeper fees available yet');
        return;
      }

      // Get batch incentive info
      const batchSize = this.config.batchSize;
      const [canProcess, estimatedReward, remainingUsers] =
        await this.manager.getBatchIncentive(batchSize);

      if (!canProcess) {
        console.log('Cannot process batch at this time');
        return;
      }

      console.log(`Batch opportunity: ${remainingUsers} users remaining`);
      console.log(`Estimated reward: ${ethers.formatEther(estimatedReward)} DAI`);

      // Estimate gas cost
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice;
      const estimatedGas = this.config.batchGasEstimate;
      const gasCostWei = gasPrice * BigInt(estimatedGas);
      const gasCostDAI = gasCostWei; // 1:1 on Gnosis

      console.log(`Estimated gas cost: ${ethers.formatEther(gasCostDAI)} DAI`);
      console.log(`Net profit: ${ethers.formatEther(estimatedReward - gasCostDAI)} DAI`);

      // Check profitability
      const minProfit = gasCostDAI * BigInt(this.config.minProfitMarginPercent) / 100n;
      if (estimatedReward < gasCostDAI + minProfit) {
        console.log('Batch processing not profitable yet, waiting...');
        return;
      }

      // Execute batch processing
      console.log(`Processing batch of ${batchSize} users...`);
      this.processingBatch = true;

      const tx = await this.manager.processBatch(batchSize, {
        gasLimit: estimatedGas
      });

      console.log(`Batch processing transaction sent: ${tx.hash}`);
      const receipt = await tx.wait();

      console.log(`Batch processed successfully! Gas used: ${receipt.gasUsed.toString()}`);
      console.log(`Keeper fee earned: ${ethers.formatEther(estimatedReward)} DAI`);

      this.processingBatch = false;

      // Check if more batches remain
      const newDistState = await this.manager.distributionState();
      if (newDistState.active) {
        console.log('More batches remaining, checking again...');
        // Recursively check for more batches (with small delay to avoid spam)
        setTimeout(() => this.checkAndProcessBatches(), 5000);
      } else {
        console.log('Distribution complete!');
      }

    } catch (error) {
      this.processingBatch = false;
      console.error('Error during batch processing:', error.message);

      if (error.transaction) {
        console.error('Transaction details:', error.transaction);
      }
    }
  }

  /**
   * Get keeper status
   */
  async getStatus() {
    try {
      const balance = await this.provider.getBalance(this.wallet.address);
      const yieldAvailable = await this.manager.previewYield();
      const distState = await this.manager.distributionState();
      const keeperFeePool = await this.manager.keeperFeePool();

      return {
        keeperAddress: this.wallet.address,
        xdaiBalance: ethers.formatEther(balance),
        yieldAvailable: ethers.formatEther(yieldAvailable),
        distributionActive: distState.active,
        remainingBZZ: ethers.formatEther(distState.totalBZZ),
        keeperFeePool: ethers.formatEther(keeperFeePool),
        isRunning: this.isRunning,
        harvesting: this.harvesting,
        processingBatch: this.processingBatch
      };
    } catch (error) {
      console.error('Error fetching status:', error.message);
      return null;
    }
  }

  /**
   * Print status to console
   */
  async printStatus() {
    const status = await this.getStatus();
    if (status) {
      console.log('\n=== Keeper Status ===');
      console.log(`Keeper Address: ${status.keeperAddress}`);
      console.log(`xDAI Balance: ${status.xdaiBalance}`);
      console.log(`Yield Available: ${status.yieldAvailable} DAI`);
      console.log(`Distribution Active: ${status.distributionActive}`);
      console.log(`Remaining BZZ: ${status.remainingBZZ}`);
      console.log(`Keeper Fee Pool: ${status.keeperFeePool} DAI`);
      console.log(`Bot Running: ${status.isRunning}`);
      console.log(`Currently Harvesting: ${status.harvesting}`);
      console.log(`Currently Processing Batch: ${status.processingBatch}`);
      console.log('==================\n');
    }
  }
}

module.exports = HostasisKeeper;
