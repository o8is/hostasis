/**
 * Hostasis Keeper Bot
 *
 * Automated keeper that:
 * 1. Monitors yield accumulation and calls harvest() when profitable
 * 2. Processes batch distributions to earn keeper fees
 * 3. Manages gas costs vs rewards to ensure profitability
 */

const { ethers } = require('ethers');

// Contract ABIs (minimal - only what we need)
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

// wxDAI (Wrapped xDAI) contract on Gnosis Chain
const WXDAI_ADDRESS = '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d';
const WXDAI_ABI = [
  'function balanceOf(address) external view returns (uint256)',
  'function withdraw(uint256 wad) external'
];

class HostasisKeeper {
  constructor(config) {
    if (!config) {
      throw new Error('Config is required');
    }
    this.config = config;
    this.isRunning = false;
    this.processingBatch = false;
    this.harvesting = false;

    // Setup provider and wallet
    this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
    this.wallet = new ethers.Wallet(this.config.privateKey, this.provider);

    // Setup contracts
    this.manager = new ethers.Contract(
      this.config.managerAddress,
      MANAGER_ABI,
      this.wallet
    );

    this.wxdai = new ethers.Contract(
      WXDAI_ADDRESS,
      WXDAI_ABI,
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

    // Unwrap any accumulated wxDAI on start
    await this.unwrapWxDAI();

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
   * Unwrap wxDAI to xDAI for gas
   */
  async unwrapWxDAI() {
    try {
      const wxdaiBalance = await this.wxdai.balanceOf(this.wallet.address);

      if (wxdaiBalance === 0n) {
        return;
      }

      console.log(`Unwrapping ${ethers.formatEther(wxdaiBalance)} wxDAI to xDAI...`);

      const tx = await this.wxdai.withdraw(wxdaiBalance, {
        gasLimit: this.config.unwrapGasEstimate
      });

      console.log(`Unwrap transaction sent: ${tx.hash}`);
      const receipt = await tx.wait();

      console.log(`Unwrap successful! Gas used: ${receipt.gasUsed.toString()}`);
      console.log(`Converted ${ethers.formatEther(wxdaiBalance)} wxDAI to xDAI`);

    } catch (error) {
      console.error('Error unwrapping wxDAI:', error.message);
    }
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

      // Estimate gas cost (harvest + unwrap)
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice;
      const harvestGas = BigInt(this.config.harvestGasEstimate);
      const unwrapGas = BigInt(this.config.unwrapGasEstimate);
      const totalGas = harvestGas + unwrapGas;
      const gasCostWei = gasPrice * totalGas;

      // Convert gas cost from xDAI to DAI equivalent (1:1 on Gnosis)
      const gasCostDAI = gasCostWei;

      console.log(`Estimated gas cost (harvest + unwrap): ${ethers.formatEther(gasCostDAI)} DAI`);
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
        gasLimit: harvestGas
      });

      console.log(`Harvest transaction sent: ${tx.hash}`);
      const receipt = await tx.wait();

      console.log(`Harvest successful! Gas used: ${receipt.gasUsed.toString()}`);
      console.log(`Harvester fee earned: ${ethers.formatEther(harvesterFee)} wxDAI`);

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

      // Estimate gas cost (batch + unwrap)
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice;
      const batchGas = BigInt(this.config.batchGasEstimate);
      const unwrapGas = BigInt(this.config.unwrapGasEstimate);
      const totalGas = batchGas + unwrapGas;
      const gasCostWei = gasPrice * totalGas;
      const gasCostDAI = gasCostWei; // 1:1 on Gnosis

      console.log(`Estimated gas cost (batch + unwrap): ${ethers.formatEther(gasCostDAI)} DAI`);
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
        gasLimit: batchGas
      });

      console.log(`Batch processing transaction sent: ${tx.hash}`);
      const receipt = await tx.wait();

      console.log(`Batch processed successfully! Gas used: ${receipt.gasUsed.toString()}`);
      console.log(`Keeper fee earned: ${ethers.formatEther(estimatedReward)} wxDAI`);

      this.processingBatch = false;

      // Check if more batches remain
      const newDistState = await this.manager.distributionState();
      if (newDistState.active) {
        console.log('More batches remaining, checking again...');
        // Recursively check for more batches (with small delay to avoid spam)
        setTimeout(() => this.checkAndProcessBatches(), 5000);
      } else {
        console.log('Distribution complete!');
        // Unwrap all accumulated wxDAI to xDAI for gas
        await this.unwrapWxDAI();
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
      const wxdaiBalance = await this.wxdai.balanceOf(this.wallet.address);
      const yieldAvailable = await this.manager.previewYield();
      const distState = await this.manager.distributionState();
      const keeperFeePool = await this.manager.keeperFeePool();

      return {
        keeperAddress: this.wallet.address,
        xdaiBalance: ethers.formatEther(balance),
        wxdaiBalance: ethers.formatEther(wxdaiBalance),
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
      console.log(`wxDAI Balance: ${status.wxdaiBalance}`);
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
