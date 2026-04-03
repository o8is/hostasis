# Hostasis

Hostasis enables users to deposit sDAI and automatically direct the accrued yield to fund their Swarm postage stamps for permanent decentralized hosting.

## What Is Implemented

- Users deposit `sDAI` against a specific Swarm `stampId`.
- Each deposit tracks `sDAIAmount`, `principalDAI`, `totalYieldClaimed`, `stampId`, and `depositTime`.
- Yield is measured in `wxDAI` terms using `SDAI.convertToAssets(1e18)`.
- `harvest()` is permissionless. It pays a harvester fee, allocates keeper fees, swaps the remaining `wxDAI` into `BZZ`, and opens a batch distribution window.
- `processBatch(batchSize)` is permissionless. It distributes `BZZ` across active users and pays the caller from the keeper fee pool.
- Harvests are serialized. A second `harvest()` is blocked until the current distribution finishes.
- While a distribution is active, `deposit`, `depositWithPermit`, `topUp`, `topUpWithPermit`, and `withdraw` are blocked so the harvest snapshot cannot be mutated mid-cycle.
- `updateStampId()` remains available so a user can correct a bad batch id before keepers process their entry.

## Contract Model

The core contract is [`src/PostageYieldManagerUpgradeable.sol`](src/PostageYieldManagerUpgradeable.sol).

Important details:

- The contract is deployed behind a Transparent Proxy.
- `SDAI` is the savings token on Gnosis.
- `DAI` in the code is actually the `wxDAI` ERC-20 address on Gnosis.
- Swaps are done directly against a Uniswap V3-compatible `BZZ/wxDAI` pool.
- Swarm top-ups use `topUp(bytes32 batchId, uint256 topupAmountPerChunk)`, so the contract converts each user's `BZZ` allocation into a per-chunk amount using the batch depth.

The main accounting structs are:

```solidity
struct Deposit {
    uint256 sDAIAmount;
    uint256 principalDAI;
    uint256 totalYieldClaimed;
    bytes32 stampId;
    uint256 depositTime;
}

struct DistributionState {
    uint256 totalBZZ;
    uint256 cursor;
    uint256 totalYieldDAI;
    uint256 snapshotRate;
    uint256 snapshotTotalSDAI;
    bool active;
}
```

## Lifecycle

### Deposit

- `deposit(uint256 sDAIAmount, bytes32 stampId)`
- `depositWithPermit(uint256 sDAIAmount, bytes32 stampId, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`

Each deposit stores the current `wxDAI` value as `principalDAI`. That is the basis used to prevent later depositors from inheriting earlier yield.

### Top Up

- `topUp(uint256 depositIndex, uint256 sDAIAmount)`
- `topUpWithPermit(uint256 depositIndex, uint256 sDAIAmount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`

Top-ups increase both `sDAIAmount` and `principalDAI` at the current exchange rate.

### Withdraw

- `withdraw(uint256 depositIndex, uint256 sDAIAmount)`

Withdrawals return `sDAI` shares, not `wxDAI`. The contract reduces `principalDAI` proportionally to the amount withdrawn.

### Preview Functions

- `previewYield()` returns total contract yield in `wxDAI`.
- `previewUserYield(address user, uint256 depositIndex)` returns the current unrealized yield for one deposit.

### Harvest

`harvest()` does the following:

1. Reverts if a previous distribution is still active.
2. Computes total yield from `totalSDAI` and `totalPrincipalDAI`.
3. Converts that realized yield into `sDAI` shares and redeems them to `wxDAI`.
4. Pays the harvester fee to `msg.sender`.
5. Adds the keeper fee allocation to `keeperFeePool`.
6. Swaps the remaining `wxDAI` into `BZZ`.
7. Stores a distribution snapshot so keepers can process users in batches.

Important nuance: harvest reduces global `totalSDAI` immediately. Individual deposit balances are updated later during `processBatch()`.

### Batch Distribution

`processBatch(uint256 batchSize)` iterates across `activeUsers` from the current cursor:

- It computes each deposit's yield share using the harvest snapshot.
- It converts that yield share into a `BZZ` allocation.
- It converts the `BZZ` allocation into a per-chunk Swarm top-up based on `batchDepth(stampId)`.
- It reduces each deposit's `sDAIAmount` by the realized yield shares consumed in that harvest.
- It pays the keeper a proportional share of `keeperFeePool`.

Distribution is based on yield earned, not raw `sDAI` balance. That matters when users entered at different exchange rates.

## Current Parameters

Defaults set in `initialize()`:

- `minYieldThreshold = 0.01 ether`
- `harvesterFeeBps = 50` (0.5%)
- `keeperFeeBps = 100` (1%)

Owner controls:

- `setBzzWxdaiPool(address)`
- `setMinYieldThreshold(uint256)`
- `setHarvesterFee(uint256)` capped at 200 bps
- `setKeeperFee(uint256)` capped at 500 bps

## Gnosis Addresses

External dependencies hardcoded in the deploy script:

- `sDAI`: `0xaf204776c7245bF4147c2612BF6e5972Ee483701`
- `wxDAI`: `0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d`
- `BZZ`: `0xdBF3Ea6F5beE45c02255B2c26a16F300502F68da`
- `Swarm PostageStamp`: `0x45a1502382541Cd610CC9068e88727426b696293`
- `BZZ/wxDAI pool`: `0x7583b9C573FA4FB5Ea21C83454939c4Cf6aacBc3`

Repo-configured frontend target:

- `PostageYieldManager` proxy: `0x3E4cc34e228841606DE7EEb5245Bc30cA979AF23`


## Repo Layout

- `src/`: Solidity contracts and interfaces
- `test/unit/`: Foundry unit and invariant tests
- `script/`: deploy and upgrade scripts
- `keeper/`: Node-based harvester/keeper bot
- `hostasis-frontend/`: Next.js frontend

## Local Development

Build:

```bash
forge build
```

Run tests:

```bash
forge test
```

Deploy the proxy:

```bash
forge script script/DeployUpgradeable.s.sol --rpc-url gnosis --broadcast
```

Upgrade an existing proxy:

```bash
PROXY_ADDRESS=<proxy> forge script script/UpgradeContract.s.sol --rpc-url gnosis --broadcast
```

If the ABI changed, update the frontend copy:

```bash
./update-frontend-abi.sh
```

## Operational Notes

- `harvest()` is not owner-only. Any account can harvest and earn the configured harvester fee.
- `processBatch()` is not owner-only. Any account can process a batch and earn keeper fees.
- Small `BZZ` allocations can round down to zero if they are less than one token per chunk for a given Swarm batch depth.
- The system is not audited.

## Tests

The current behavior is covered primarily by:

- `test/unit/PostageYieldManager.t.sol`
- `test/unit/KeeperIncentives.t.sol`
- `test/unit/PostageYieldManagerInvariants.t.sol`

These tests cover:

- principal accounting across deposits at different exchange rates
- permissionless harvest and batch processing
- keeper and harvester fee flows
- multi-harvest regression cases
- invariant checks around solvency and rounding dust

## License

MIT
