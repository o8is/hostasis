# Hostasis: Swarm Postage Stamp Yield Distribution

## Overview

Hostasis enables users to deposit DAI and automatically direct the accrued yield (from DSR) to fund their Swarm postage stamps for permanent decentralized storage.

## Problem Statement

- **Storage costs**: Swarm postage stamps require BZZ tokens to maintain
- **Manual management**: Users must manually top up stamps
- **Yield opportunity**: sDAI earns ~4% APY

## Solution

Deploy entirely on Gnosis Chain where:

1. Users deposit sDAI and supply a postage stamp address.
1. Contract automates harvesting yield and topping up postage.
1. Principal is left untouched, and as long as it generates yield the files will be persisted.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                      Gnosis Chain                                       │
│                                                                                         │
│    ┌─────────────────────────────────────────────────────┐                              │
│    │ sDAI Contract (0xaf20...3701)                       │                              │
│    │                                                     │                              │
│    │ - ERC4626 Vault                                     │                              │
│    │ - convertToAssets(1e18) → returns exchange rate     │                              │
│    │ - Earns Sky Protocol DSR yield automatically        │                              │
│    │                                                     │                              │
│    └─────────────────────────────────────────────────────┘                              │
│                               ▲                                                         │
│                               │                                                         │
│                               ▼                                                         │
│    ┌─────────────────────────────────────────────────────┐                              │
│    │ Hostasis Contract                                   │                              │
│    │                                                     │      ┌────────────────────┐  │
│    │ 1. Users deposit sDAI + specify batchId             │      │ DEX Contract       │  │
│    │ 2. Track principal value in DAI                     │      │                    │  │
│    │ 3. Calculate yield: currentValue - principalValue   │◀────▶│ - Swap DAI to BZZ  │  │
│    │ 4. Redeem yield portion: sDAI → DAI                 │      │                    │  │
│    │ 5. Swap DAI → BZZ                                   │      └────────────────────┘  │
│    │ 6. Top up postage stamps proportionally             │                              │
│    │                                                     │                              │
│    └─────────────────────────────────────────────────────┘                              │
│                               │                                                         │
│                               ▼                                                         │
│    ┌─────────────────────────────────────────────────────┐                              │
│    │ Postage Stamp Contract (Swarm)                      │                              │
│    │                                                     │                              │
│    │ - topUp(batchId, bzzAmount)                         │                              │
│    │                                                     │                              │
│    │                                                     │                              │
│    └─────────────────────────────────────────────────────┘                              │
│                                                                                         │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. PostageYieldManager

**Deposit Tracking:**

```solidity
struct Deposit {
    uint256 sDAIAmount;        // sDAI shares deposited
    uint256 principalDAI;      // DAI value at deposit time (KEY!)
    bytes32 stampId;           // Swarm postage batch ID
    uint256 depositTime;       // Timestamp
}

mapping(address => Deposit[]) public userDeposits;
```

**Yield Calculation:**

```solidity
function previewYield() public view returns (uint256 yieldDAI) {
    uint256 currentRate = SDAI.convertToAssets(1e18);  // Free call!
    uint256 currentValueDAI = (totalSDAI * currentRate) / 1e18;

    if (currentValueDAI > totalPrincipalDAI) {
        yieldDAI = currentValueDAI - totalPrincipalDAI;
    }
}
```

**Harvest Flow:**

```solidity
function harvest() external onlyOwner {
    // 1. Calculate yield
    uint256 totalYield = previewYield();

    // 2. Convert yield to sDAI shares
    uint256 yieldShares = SDAI.convertToShares(totalYield);

    // 3. Redeem sDAI → DAI
    uint256 daiReceived = SDAI.redeem(yieldShares, address(this), address(this));

    // 4. Allocate keeper fees (1-2% of DAI)
    uint256 keeperFee = (daiReceived * keeperFeeBps) / 10000;
    keeperFeePool += keeperFee;
    uint256 daiToSwap = daiReceived - keeperFee;

    // 5. Swap DAI → BZZ on DEX
    uint256 bzzReceived = _swapDAIForBZZ(daiToSwap);

    // 6. Setup batch distribution (processed by keepers)
    distributionState = DistributionState({
        totalBZZ: bzzReceived,
        cursor: 0,
        snapshotTotalSDAI: totalSDAI,
        active: true
    });

    // 7. Update principal (prevent re-harvesting)
    totalPrincipalDAI += totalYield;
}
```

### 2. sDAI on Gnosis Chain

**Contract Address:** `0xaf204776c7245bf4147c2612bf6e5972ee483701`

**Key Features:**

- Full ERC4626 vault interface
- `convertToAssets(shares)` - Get DAI value
- `convertToShares(assets)` - Get sDAI shares needed
- Rate updates every 1-2 days via Spark's oracle
- Earns Sky Protocol DSR (same as mainnet sUSDS)

### 3. Distribution Strategy & Keeper Incentives

**Scalable Batch Distribution:**

The contract uses a permissionless keeper system to distribute BZZ to stamps in batches:

```solidity
// During harvest: Allocate keeper fees (1-2% of yield)
uint256 keeperFee = (daiReceived * keeperFeeBps) / 10000;
keeperFeePool += keeperFee;

// Setup batch distribution
distributionState = DistributionState({
    totalBZZ: bzzReceived,
    cursor: 0,
    snapshotTotalSDAI: totalSDAI,
    active: true
});

// Anyone can call processBatch() to distribute and earn DAI
function processBatch(uint256 batchSize) external {
    for (uint256 i = cursor; i < cursor + batchSize; i++) {
        // Distribute BZZ proportionally to user's stamps
        uint256 bzzShare = (totalBZZ * deposit.sDAIAmount) / snapshotTotalSDAI;
        POSTAGE_STAMP.topUp(deposit.stampId, bzzShare);
    }

    // Pay keeper in DAI
    DAI.transfer(msg.sender, feePerBatch);
}
```

**Keeper Incentive Economics:**

- Harvest allocates 1-2% of DAI yield as keeper fees
- Permissionless: **anyone** can call `processBatch()`
- Keepers earn % of DAI per user in batch processed
- Competitive market: keepers wait for profitability
- Larger yield pool = more keeper incentive = faster processing

**Example:**

- 100 users deposit 100 sDAI each
- Yield harvest = 100 DAI
- Keeper fees (1%) = 1 DAI allocated
- Fee per batch = 0.1 DAI
- Keeper can process 10 batches, earning 1 DAI total
- As more yield accrues, competition ensures timely processing

---

## User Journey

### Initial Deposit

```javascript
// 1. User has sDAI on Gnosis
const sdaiBalance = await sdai.balanceOf(userAddress);

// 2. User approves PostageYieldManager
await sdai.approve(postageManager.address, amount);

// 3. User deposits and specifies postage stamp ID
const tx = await postageManager.deposit(
  ethers.utils.parseEther("100"), // 100 sDAI
  "0xabc123..." // Postage stamp batch ID
);

// Cost: ~$0.01 on Gnosis
```

### Multiple Deposits (Different Projects)

```javascript
// Project A - Blog hosting
await postageManager.deposit(ethers.utils.parseEther("100"), STAMP_BLOG);

// Project B - NFT metadata
await postageManager.deposit(ethers.utils.parseEther("50"), STAMP_NFTS);

// Each deposit maintains independent tracking!
```

### Withdrawing

```javascript
// Withdraw from specific deposit
await postageManager.withdraw(
  0, // Deposit index
  ethers.utils.parseEther("50") // Amount
);

// Remaining sDAI continues earning yield
```

### Updating Stamp ID

```javascript
// Switch to a new postage stamp
await postageManager.updateStampId(
  0, // Deposit index
  NEW_STAMP_ID
);
```

---

## Harvest Flow

### Harvest

```javascript
// Step 1: Check yield available
const yieldAvailable = await postageManager.previewYield();
console.log(
  "Yield available:",
  ethers.utils.formatEther(yieldAvailable),
  "DAI"
);

// Step 2: Harvest (if above threshold)
if (yieldAvailable >= minThreshold) {
  const tx = await postageManager.harvest();
  // Automatically:
  // - Calculates yield
  // - Allocates 1-2% as keeper fees
  // - Redeems sDAI → DAI
  // - Swaps DAI → BZZ
  // - Sets up batch distribution
}
```

### Keepers Process Distribution

```javascript
// Anyone can be a keeper! Check incentives first:
const [canProcess, reward, remainingUsers] =
  await postageManager.getBatchIncentive();

if (canProcess && reward > estimatedGasCost) {
  // Profitable! Process a batch
  const tx = await postageManager.processBatch(20); // Process 20 users
  // Keeper receives DAI reward immediately
}

// Monitor for profitable opportunities
while (await getBatchIncentive()[0]) {
  await processBatch(20);
  // Earn DAI for each batch!
}
```

**Keeper Economics:**

- Wait for keeper fee pool to build up
- Multiple keepers can compete for batches
- First-come-first-serve batch processing
- Can process any batch size (gas vs reward tradeoff)
- Total distribution completes when all users processed

---

## Keeper Operations

### Setting Up a Keeper Bot

```javascript
// Simple keeper bot example
async function keeperBot() {
  while (true) {
    // Check if distribution is active and profitable
    const [canProcess, reward, remaining] =
      await postageManager.getBatchIncentive();

    if (canProcess) {
      const gasPrice = await ethers.provider.getGasPrice();
      const estimatedGas = 200000; // ~200k gas per batch
      const gasCost = gasPrice.mul(estimatedGas);

      // Only process if reward > gas cost
      if (reward.gt(gasCost)) {
        console.log(
          `Processing batch. Reward: ${ethers.utils.formatEther(reward)} DAI`
        );
        const tx = await postageManager.processBatch(20);
        await tx.wait();
      }
    }

    // Wait before checking again
    await sleep(60000); // Check every minute
  }
}
```

### Keeper Configuration

Contract owner can adjust keeper parameters:

```javascript
// Set keeper fee percentage (max 5%)
await postageManager.setKeeperFee(150); // 1.5%

// Set harvester fee (nax 2%)
await postageManager.setHarvesterFee(ethers.utils.parseEther("0.1")); // 0.1% 
```

---

## Technical Specifications

### Contract Addresses (Gnosis Chain)

**Live Contracts:**

- sDAI: `0xaf204776c7245bf4147c2612bf6e5972ee483701`
- DAI (xDAI): `0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d`
- WXDAI: `0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d`

**To Be Deployed:**

- PostageYieldManager: 
- Swarm Postage Stamp: 
- BZZ Token: 

### Interfaces

See [src/interfaces/](src/interfaces/) for full interfaces:

- `ISavingsDai.sol` - ERC4626 sDAI interface
- `IPostageStamp.sol` - Swarm postage stamp interface
- `IDexRouter.sol` - Generic DEX router interface

---

## Security Considerations

### 1. Yield Theft Prevention

**Risk**: Later depositors steal yield from earlier depositors
**Mitigation**: Track principal in DAI terms at deposit time

```solidity
// Always store DAI value, not sDAI shares
uint256 daiValue = (sDAIAmount * currentRate) / 1e18;
deposit.principalDAI = daiValue;
```

### 2. Exchange Rate Manipulation

**Risk**: Attacker manipulates sDAI exchange rate
**Mitigation**:

- sDAI rate controlled by Spark's audited oracle
- Rate updates decentralized via Spark's infrastructure
- No single point of failure

### 3. DEX Slippage

**Risk**: Poor swap rates during DAI → BZZ conversion
**Mitigation**:

```solidity
uint256 minBZZ = (expectedBZZ * (10000 - maxSlippageBps)) / 10000;
require(bzzReceived >= minBZZ, "Slippage too high");
```

### 4. Stamp ID Validation

**Risk**: Users provide invalid stamp IDs
**Mitigation**:

- Off-chain validation recommended before deposit
- Emergency `updateStampId()` function available
- Events emitted for all stamp updates

### 5. Reentrancy

**Risk**: Reentrancy during withdraw/harvest
**Mitigation**: OpenZeppelin's `ReentrancyGuard` on all state-changing functions

---

## Future Enhancements

### 1. Multi-Token Support

Support other yield-bearing tokens:

- sUSDS (when available on Gnosis with ERC4626)
- Other ERC4626 vaults

### 2. NFT Receipts

Issue NFT receipts for deposits:

```solidity
function deposit(...) returns (uint256 depositNFT) {
    // Mint ERC721 representing the deposit
    // NFT is transferable, making deposits liquid
}
```

### 3. Governance

Add DAO for parameter management:

- Harvest frequency
- Slippage tolerance
- DEX routing strategies

---

## FAQ

**Q: Why not use sUSDS instead of sDAI?**
A: sUSDS on Gnosis doesn't have ERC4626 functionality (no `convertToAssets`). sDAI is mature, has full ERC4626, and earns the same DSR/SSR yield.

**Q: How often is the exchange rate updated?**
A: Spark's oracle updates the sDAI rate every 1-2 days. This is frequent enough for accurate yield tracking.

**Q: What if I deposit when the rate is stale?**
A: You track your principal at the current rate (even if slightly stale). Max 1-2 days drift = ~0.01-0.02% error, which is negligible.

**Q: Can I change which stamp gets the yield?**
A: Yes! Call `updateStampId()` anytime. Next harvest will use the new stamp.

**Q: What if my stamp expires?**
A: Update to a new stamp ID before harvest. The contract will revert if topping up an invalid stamp.

**Q: Is there a minimum deposit?**
A: No minimum enforced, but recommend at least 10 sDAI to make gas costs worthwhile.

**Q: How often is yield harvested?**
A: Default is monthly. Can be adjusted based on gas costs vs yield accumulated.

---

## Resources

- [Spark Protocol (sDAI)](https://spark.fi/)
- [Sky Protocol (DSR)](https://sky.money/)
- [Swarm Documentation](https://docs.ethswarm.org/)
- [Gnosis Chain](https://www.gnosis.io/)
- [sDAI on GnosisScan](https://gnosisscan.io/address/0xaf204776c7245bf4147c2612bf6e5972ee483701)

---

## License

MIT

---

## Audit Status

⚠️ **Not yet audited.** Use at your own risk. Professional security audit recommended before significant TVL.

---

## Contact

For questions or contributions, please open an issue on GitHub.
