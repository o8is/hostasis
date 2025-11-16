// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {ISavingsDai} from "./interfaces/ISavingsDai.sol";
import {IPostageStamp} from "./interfaces/IPostageStamp.sol";
import {IRouteProcessor2} from "./interfaces/IRouteProcessor2.sol";
import {IUniswapV3Pool} from "./interfaces/IUniswapV3Pool.sol";

/// @title PostageYieldManagerUpgradeable
/// @notice Manages sDAI deposits and redirects yield to Swarm postage stamps (Upgradeable)
/// @dev Uses shares-based accounting: user sDAIAmount values are fixed shares, only global totalSDAI changes
/// @dev Tracks principal in DAI terms to prevent yield theft between depositors
/// @dev Uses Transparent Proxy pattern - upgrade logic handled by ProxyAdmin
contract PostageYieldManagerUpgradeable is Initializable, OwnableUpgradeable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error ZeroAmount();
    error ZeroAddress();
    error InvalidStampId();
    error InvalidDepositIndex();
    error InsufficientBalance();
    error NoYieldAvailable();
    error NotEnoughYieldAvailable();
    error SlippageTooHigh();
    error DistributionInProgress();
    error NoDistributionActive();
    error InsufficientKeeperFees();

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event Deposited(
        address indexed user, uint256 indexed depositIndex, uint256 sDAIAmount, uint256 daiValue, bytes32 stampId
    );

    event Withdrawn(address indexed user, uint256 indexed depositIndex, uint256 sDAIAmount, uint256 daiValue);

    event YieldHarvested(uint256 totalYieldDAI, uint256 bzzAmount, uint256 timestamp);

    event StampToppedUp(bytes32 indexed stampId, uint256 bzzAmount, address indexed owner);

    event StampIdUpdated(address indexed user, uint256 indexed depositIndex, bytes32 oldStampId, bytes32 newStampId);

    event BatchProcessed(address indexed keeper, uint256 usersProcessed, uint256 keeperReward);

    event DistributionComplete(uint256 totalBZZDistributed, uint256 totalUsersProcessed);

    event KeeperFeeUpdated(uint256 newFeeBps);

    event HarvesterFeePaid(address indexed harvester, uint256 amount);

    event HarvesterFeeUpdated(uint256 newFeeBps);

    /*//////////////////////////////////////////////////////////////
                            STATE VARIABLES
    //////////////////////////////////////////////////////////////*/

    /// @notice sDAI token on Gnosis Chain
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    ISavingsDai public SDAI;

    /// @notice wxDAI token on Gnosis Chain (ERC-20 wrapped xDAI)
    /// @dev This is NOT native xDAI - it's the wrapped ERC-20 version at 0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    IERC20 public DAI;

    /// @notice BZZ token on Gnosis Chain
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    IERC20 public BZZ;

    /// @notice Swarm Postage Stamp contract
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    IPostageStamp public POSTAGE_STAMP;

    /// @notice SushiSwap RouteProcessor2 for swapping DAI -> BZZ
    IRouteProcessor2 public routeProcessor;

    /// @notice BZZ/wxDAI pool address for route encoding
    address public bzzWxdaiPool;

    /// @notice Minimum yield threshold before harvest (in DAI)
    uint256 public minYieldThreshold;

    /// @notice Maximum slippage tolerance in basis points (e.g., 100 = 1%)
    uint256 public maxSlippageBps;

    /// @notice Struct representing a user's deposit
    struct Deposit {
        uint256 sDAIAmount; // Amount of sDAI shares deposited
        uint256 principalDAI; // DAI value at time of deposit (prevents yield theft)
        uint256 lastYieldPerShare; // Dividend tracking: yieldPerShare value at last claim
        bytes32 stampId; // Swarm postage batch ID to fund
        uint256 depositTime; // Timestamp of deposit
    }

    /// @notice Maps user address to their deposits
    mapping(address => Deposit[]) public userDeposits;

    /// @notice Total sDAI held in contract
    uint256 public totalSDAI;

    /// @notice Total principal value in DAI terms (sum of all principalDAI)
    uint256 public totalPrincipalDAI;

    /// @notice Last harvest timestamp
    uint256 public lastHarvestTime;

    /// @notice Harvester fee in basis points (e.g., 50 = 0.5%)
    uint256 public harvesterFeeBps;

    /// @notice Keeper fee in basis points (e.g., 100 = 1%)
    uint256 public keeperFeeBps;

    /// @notice Accumulated keeper fees (in DAI)
    uint256 public keeperFeePool;

    /// @notice Dividend accumulator: total DAI yield per sDAI share (scaled by 1e18)
    /// @dev This is a monotonically increasing value that tracks cumulative yield distribution
    uint256 public yieldPerShare;

    /// @notice Distribution state
    struct DistributionState {
        uint256 totalBZZ; // Total BZZ to distribute
        uint256 cursor; // Current position in activeUsers array
        uint256 harvestYieldPerShare; // Snapshot of yieldPerShare at harvest time
        uint256 totalYieldDAI; // Total yield in DAI for this harvest
        uint256 snapshotRate; // Exchange rate (DAI per sDAI) at time of harvest
        bool active; // Is distribution ongoing
    }
    DistributionState public distributionState;

    /// @notice Active users with deposits
    address[] public activeUsers;
    mapping(address => uint256) public activeUserIndex; // user => index in activeUsers (1-based, 0 = not active)

    /*//////////////////////////////////////////////////////////////
                            CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /*//////////////////////////////////////////////////////////////
                            INITIALIZER
    //////////////////////////////////////////////////////////////*/

    function initialize(
        address _sdai,
        address _dai,
        address _bzz,
        address _postageStamp,
        address _routeProcessor,
        address _bzzWxdaiPool
    ) public initializer {
        if (_sdai == address(0)) revert ZeroAddress();
        if (_dai == address(0)) revert ZeroAddress();
        if (_bzz == address(0)) revert ZeroAddress();
        if (_postageStamp == address(0)) revert ZeroAddress();
        if (_routeProcessor == address(0)) revert ZeroAddress();
        if (_bzzWxdaiPool == address(0)) revert ZeroAddress();

        __Ownable_init(msg.sender);
        // Note: ReentrancyGuardTransient doesn't need initialization

        SDAI = ISavingsDai(_sdai);
        DAI = IERC20(_dai);
        BZZ = IERC20(_bzz);
        POSTAGE_STAMP = IPostageStamp(_postageStamp);
        routeProcessor = IRouteProcessor2(_routeProcessor);
        bzzWxdaiPool = _bzzWxdaiPool;
        minYieldThreshold = 0.01 ether; // 0.01 DAI minimum
        maxSlippageBps = 500; // 5% max slippage
        harvesterFeeBps = 50; // 0.5% harvester fee
        keeperFeeBps = 100; // 1% keeper fee
        lastHarvestTime = block.timestamp;
    }

    /*//////////////////////////////////////////////////////////////
                        DEPOSIT & WITHDRAWAL
    //////////////////////////////////////////////////////////////*/

    /// @notice Deposit sDAI and specify a Swarm postage stamp to fund
    /// @param sDAIAmount Amount of sDAI to deposit
    /// @param stampId Swarm postage batch ID (32 bytes)
    /// @return depositIndex Index of the created deposit
    function deposit(uint256 sDAIAmount, bytes32 stampId) external nonReentrant returns (uint256 depositIndex) {
        if (sDAIAmount == 0) revert ZeroAmount();
        if (stampId == bytes32(0)) revert InvalidStampId();

        // Get current exchange rate
        uint256 currentRate = SDAI.convertToAssets(1e18); // DAI per 1 sDAI

        // Calculate DAI value at current rate
        uint256 daiValue = (sDAIAmount * currentRate) / 1e18;

        // Transfer sDAI from user
        IERC20(address(SDAI)).safeTransferFrom(msg.sender, address(this), sDAIAmount);

        // Create deposit record
        depositIndex = userDeposits[msg.sender].length;
        userDeposits[msg.sender].push(
            Deposit({
                sDAIAmount: sDAIAmount,
                principalDAI: daiValue,
                lastYieldPerShare: yieldPerShare, // Initialize to current accumulator value
                stampId: stampId,
                depositTime: block.timestamp
            })
        );

        // Update global tracking
        totalSDAI += sDAIAmount;
        totalPrincipalDAI += daiValue;

        // Track active user
        _addActiveUser(msg.sender);

        emit Deposited(msg.sender, depositIndex, sDAIAmount, daiValue, stampId);
    }

    /// @notice Deposit sDAI using EIP-2612 permit for gasless approval
    /// @param sDAIAmount Amount of sDAI to deposit
    /// @param stampId Swarm postage batch ID (32 bytes)
    /// @param deadline Permit signature deadline
    /// @param v Permit signature v component
    /// @param r Permit signature r component
    /// @param s Permit signature s component
    /// @return depositIndex Index of the created deposit
    function depositWithPermit(uint256 sDAIAmount, bytes32 stampId, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
        returns (uint256 depositIndex)
    {
        if (sDAIAmount == 0) revert ZeroAmount();
        if (stampId == bytes32(0)) revert InvalidStampId();

        // Execute permit to approve this contract
        SDAI.permit(msg.sender, address(this), sDAIAmount, deadline, v, r, s);

        // Get current exchange rate
        uint256 currentRate = SDAI.convertToAssets(1e18); // DAI per 1 sDAI

        // Calculate DAI value at current rate
        uint256 daiValue = (sDAIAmount * currentRate) / 1e18;

        // Transfer sDAI from user
        IERC20(address(SDAI)).safeTransferFrom(msg.sender, address(this), sDAIAmount);

        // Create deposit record
        depositIndex = userDeposits[msg.sender].length;
        userDeposits[msg.sender].push(
            Deposit({
                sDAIAmount: sDAIAmount,
                principalDAI: daiValue,
                lastYieldPerShare: yieldPerShare, // Initialize to current accumulator value
                stampId: stampId,
                depositTime: block.timestamp
            })
        );

        // Update global tracking
        totalSDAI += sDAIAmount;
        totalPrincipalDAI += daiValue;

        // Track active user
        _addActiveUser(msg.sender);

        emit Deposited(msg.sender, depositIndex, sDAIAmount, daiValue, stampId);
    }

    /// @notice Withdraw sDAI from a specific deposit
    /// @param depositIndex Index of the deposit to withdraw from
    /// @param sDAIAmount Amount of sDAI to withdraw
    function withdraw(uint256 depositIndex, uint256 sDAIAmount) external nonReentrant {
        if (depositIndex >= userDeposits[msg.sender].length) {
            revert InvalidDepositIndex();
        }
        if (sDAIAmount == 0) revert ZeroAmount();

        Deposit storage userDeposit = userDeposits[msg.sender][depositIndex];
        if (sDAIAmount > userDeposit.sDAIAmount) revert InsufficientBalance();

        // Calculate proportional DAI value to subtract
        uint256 daiValueWithdrawn = (userDeposit.principalDAI * sDAIAmount) / userDeposit.sDAIAmount;

        // Update deposit
        userDeposit.sDAIAmount -= sDAIAmount;
        userDeposit.principalDAI -= daiValueWithdrawn;

        // Update global tracking
        totalSDAI -= sDAIAmount;
        totalPrincipalDAI -= daiValueWithdrawn;

        // Transfer sDAI back to user
        IERC20(address(SDAI)).safeTransfer(msg.sender, sDAIAmount);

        // Remove from active users if no deposits left
        if (_getUserTotalSDAI(msg.sender) == 0) {
            _removeActiveUser(msg.sender);
        }

        emit Withdrawn(msg.sender, depositIndex, sDAIAmount, daiValueWithdrawn);
    }

    /// @notice Update the stamp ID for a deposit
    /// @param depositIndex Index of the deposit
    /// @param newStampId New postage batch ID
    function updateStampId(uint256 depositIndex, bytes32 newStampId) external {
        if (depositIndex >= userDeposits[msg.sender].length) {
            revert InvalidDepositIndex();
        }
        if (newStampId == bytes32(0)) revert InvalidStampId();

        Deposit storage userDeposit = userDeposits[msg.sender][depositIndex];
        bytes32 oldStampId = userDeposit.stampId;
        userDeposit.stampId = newStampId;

        emit StampIdUpdated(msg.sender, depositIndex, oldStampId, newStampId);
    }

    /// @notice Top up an existing deposit with additional sDAI
    /// @param depositIndex Index of the deposit to top up
    /// @param sDAIAmount Amount of sDAI to add
    function topUp(uint256 depositIndex, uint256 sDAIAmount) external nonReentrant {
        if (depositIndex >= userDeposits[msg.sender].length) {
            revert InvalidDepositIndex();
        }
        if (sDAIAmount == 0) revert ZeroAmount();

        Deposit storage userDeposit = userDeposits[msg.sender][depositIndex];

        // Get current exchange rate
        uint256 currentRate = SDAI.convertToAssets(1e18); // DAI per 1 sDAI

        // Calculate DAI value at current rate
        uint256 daiValue = (sDAIAmount * currentRate) / 1e18;

        // Transfer sDAI from user
        IERC20(address(SDAI)).safeTransferFrom(msg.sender, address(this), sDAIAmount);

        // Update deposit
        userDeposit.sDAIAmount += sDAIAmount;
        userDeposit.principalDAI += daiValue;

        // Update global tracking
        totalSDAI += sDAIAmount;
        totalPrincipalDAI += daiValue;

        // Ensure user is tracked as active
        _addActiveUser(msg.sender);

        emit Deposited(msg.sender, depositIndex, sDAIAmount, daiValue, userDeposit.stampId);
    }

    /// @notice Top up an existing deposit using EIP-2612 permit for gasless approval
    /// @param depositIndex Index of the deposit to top up
    /// @param sDAIAmount Amount of sDAI to add
    /// @param deadline Permit signature deadline
    /// @param v Permit signature v component
    /// @param r Permit signature r component
    /// @param s Permit signature s component
    function topUpWithPermit(uint256 depositIndex, uint256 sDAIAmount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
    {
        if (depositIndex >= userDeposits[msg.sender].length) {
            revert InvalidDepositIndex();
        }
        if (sDAIAmount == 0) revert ZeroAmount();

        // Execute permit to approve this contract
        SDAI.permit(msg.sender, address(this), sDAIAmount, deadline, v, r, s);

        // Get current exchange rate
        uint256 currentRate = SDAI.convertToAssets(1e18);

        // Calculate DAI value at current rate
        uint256 daiValue = (sDAIAmount * currentRate) / 1e18;

        // Transfer sDAI from user
        IERC20(address(SDAI)).safeTransferFrom(msg.sender, address(this), sDAIAmount);

        // Update deposit
        Deposit storage userDeposit = userDeposits[msg.sender][depositIndex];
        userDeposit.sDAIAmount += sDAIAmount;
        userDeposit.principalDAI += daiValue;

        // Update global tracking
        totalSDAI += sDAIAmount;
        totalPrincipalDAI += daiValue;

        // Ensure user is tracked as active
        _addActiveUser(msg.sender);

        emit Deposited(msg.sender, depositIndex, sDAIAmount, daiValue, userDeposit.stampId);
    }

    /*//////////////////////////////////////////////////////////////
                        YIELD CALCULATION
    //////////////////////////////////////////////////////////////*/

    /// @notice Calculate total yield available across all deposits
    /// @return yieldDAI Total yield in DAI terms
    function previewYield() public view returns (uint256 yieldDAI) {
        if (totalSDAI == 0) return 0;

        // Get current exchange rate
        uint256 currentRate = SDAI.convertToAssets(1e18);

        // Calculate current total value in DAI
        uint256 currentValueDAI = (totalSDAI * currentRate) / 1e18;

        // Yield = current value - original principal
        if (currentValueDAI > totalPrincipalDAI) {
            yieldDAI = currentValueDAI - totalPrincipalDAI;
        }
    }

    /// @notice Preview yield for a specific user's deposit
    /// @param user User address
    /// @param depositIndex Deposit index
    /// @return yieldDAI Yield in DAI terms for this deposit
    function previewUserYield(address user, uint256 depositIndex) external view returns (uint256 yieldDAI) {
        if (depositIndex >= userDeposits[user].length) return 0;

        Deposit memory userDeposit = userDeposits[user][depositIndex];
        uint256 currentRate = SDAI.convertToAssets(1e18);
        uint256 currentValue = (userDeposit.sDAIAmount * currentRate) / 1e18;

        if (currentValue > userDeposit.principalDAI) {
            yieldDAI = currentValue - userDeposit.principalDAI;
        }
    }

    /*//////////////////////////////////////////////////////////////
                        YIELD HARVESTING
    //////////////////////////////////////////////////////////////*/

    /// @notice Harvest yield and prepare for distribution
    /// @dev Swaps (yield - harvester fee - keeper fees) to BZZ, sets up batch distribution
    /// @dev Cannot be called again until processBatch completes (prevents multiple harvest complexity)
    /// @dev Uses shares-based accounting: user deposit amounts never change, only global totalSDAI changes
    function harvest() external nonReentrant {
        // Prevent multiple harvests - must complete distribution first
        if (distributionState.active) revert DistributionInProgress();

        uint256 totalYield = previewYield();
        if (totalYield == 0) revert NoYieldAvailable();
        if (totalYield < minYieldThreshold) revert NotEnoughYieldAvailable();

        // Snapshot exchange rate at harvest time for yield calculations
        uint256 currentRate = SDAI.convertToAssets(1e18);

        // Update dividend accumulator BEFORE reducing totalSDAI
        // This tracks cumulative yield per share for all deposits
        uint256 yieldPerShareIncrease = (totalYield * 1e18) / totalSDAI;
        yieldPerShare += yieldPerShareIncrease;

        // Calculate sDAI shares representing the yield
        uint256 yieldShares = (totalYield * 1e18) / currentRate;

        // Update global accounting: reduce totalSDAI (yield shares removed)
        // Note: totalPrincipalDAI stays unchanged - principals never change in DAI terms
        //       Individual deposit sDAIAmounts will be reduced in processBatch to match
        totalSDAI -= yieldShares;

        // Redeem sDAI for DAI
        uint256 daiReceived = SDAI.redeem(yieldShares, address(this), address(this));

        // Pay harvester fee first
        uint256 harvesterFee = (daiReceived * harvesterFeeBps) / 10000;
        if (harvesterFee > 0) {
            DAI.safeTransfer(msg.sender, harvesterFee);
            emit HarvesterFeePaid(msg.sender, harvesterFee);
        }

        // Allocate keeper fees
        uint256 keeperFee = (daiReceived * keeperFeeBps) / 10000;
        keeperFeePool += keeperFee;
        uint256 daiToSwap = daiReceived - harvesterFee - keeperFee;

        // Swap remaining DAI -> BZZ
        uint256 bzzReceived = _swapDAIForBZZ(daiToSwap);

        // Setup distribution state with snapshots
        distributionState = DistributionState({
            totalBZZ: bzzReceived,
            cursor: 0,
            harvestYieldPerShare: yieldPerShare, // Snapshot of accumulator at harvest
            totalYieldDAI: totalYield, // Total yield in DAI for this harvest
            snapshotRate: currentRate, // Exchange rate at harvest
            active: true
        });

        lastHarvestTime = block.timestamp;

        emit YieldHarvested(totalYield, bzzReceived, block.timestamp);
    }

    /// @notice Process a batch of distributions (permissionless)
    /// @param batchSize Number of users to process in this batch
    /// @dev Anyone can call this to earn keeper fees proportional to work done
    /// @dev Distributes BZZ proportional to yield earned (not sDAI shares) to prevent yield theft
    function processBatch(uint256 batchSize) external nonReentrant {
        if (!distributionState.active) revert NoDistributionActive();
        if (keeperFeePool == 0) revert InsufficientKeeperFees();

        DistributionState storage state = distributionState;
        uint256 startCursor = state.cursor;
        uint256 endCursor = startCursor + batchSize;

        // Cap at total users
        if (endCursor > activeUsers.length) {
            endCursor = activeUsers.length;
        }

        uint256 usersProcessed = 0;

        // Process batch
        for (uint256 i = startCursor; i < endCursor; i++) {
            address user = activeUsers[i];

            // Skip if user has no deposits (withdrawn since harvest)
            if (_getUserTotalSDAI(user) == 0) continue;

            Deposit[] storage deposits = userDeposits[user];

            for (uint256 j = 0; j < deposits.length; j++) {
                Deposit storage dep = deposits[j];
                if (dep.sDAIAmount == 0) continue;

                // Calculate this deposit's unclaimed yield using dividend accumulator
                // yieldPerShareDelta represents yield earned since last claim
                uint256 yieldPerShareDelta = state.harvestYieldPerShare - dep.lastYieldPerShare;
                uint256 depositYield = (dep.sDAIAmount * yieldPerShareDelta) / 1e18;

                // Calculate sDAI shares that represent this yield (to be consumed)
                uint256 depositYieldShares = depositYield > 0 ? (depositYield * 1e18) / state.snapshotRate : 0;

                // Distribute BZZ proportional to yield (not shares!)
                uint256 bzzShare = depositYield > 0 ? (state.totalBZZ * depositYield) / state.totalYieldDAI : 0;

                if (bzzShare > 0) {
                    // Get batch depth to calculate per-chunk amount
                    // Note: Swarm's topUp() expects amount per chunk, not total amount
                    // Total BZZ transferred = perChunkAmount * 2^depth
                    uint8 depth = POSTAGE_STAMP.batchDepth(dep.stampId);
                    uint256 stampBatchSize = 1 << depth; // 2^depth
                    uint256 perChunkAmount = bzzShare / stampBatchSize;

                    // Only top up if we have at least 1 token per chunk
                    // Note: With BZZ's 16 decimals, rounding loss is negligible (< 0.000001 BZZ per user)
                    // Example: 10 BZZ @ depth 20 → loss of ~0.0000001 BZZ
                    if (perChunkAmount > 0) {
                        // Calculate actual total that will be spent
                        uint256 actualTotal = perChunkAmount * stampBatchSize;

                        // Approve and top up the postage stamp
                        BZZ.safeIncreaseAllowance(address(POSTAGE_STAMP), actualTotal);
                        POSTAGE_STAMP.topUp(dep.stampId, perChunkAmount);

                        emit StampToppedUp(dep.stampId, actualTotal, user);
                    }
                }

                // Update deposit accounting: reduce shares and update claim point
                // This keeps sum(deposit.sDAIAmount) = totalSDAI invariant
                if (depositYieldShares > 0 && depositYieldShares <= dep.sDAIAmount) {
                    dep.sDAIAmount -= depositYieldShares;
                }
                dep.lastYieldPerShare = state.harvestYieldPerShare;
            }

            usersProcessed++;
        }

        // Update cursor
        state.cursor = endCursor;

        // Calculate keeper reward proportional to work done
        // Reward = (users processed / total users) * keeper fee pool
        uint256 keeperReward = (keeperFeePool * usersProcessed) / activeUsers.length;

        // Pay keeper
        keeperFeePool -= keeperReward;
        DAI.safeTransfer(msg.sender, keeperReward);

        emit BatchProcessed(msg.sender, usersProcessed, keeperReward);

        // Check if distribution complete
        if (state.cursor >= activeUsers.length) {
            emit DistributionComplete(state.totalBZZ, activeUsers.length);

            // Reset distribution state
            delete distributionState;
        }
    }

    /// @notice Get current batch incentive info
    /// @param batchSize Expected batch size for estimation
    /// @return canProcess Whether a batch can be processed
    /// @return estimatedReward Reward for processing the specified batch size
    /// @return remainingUsers Users left to process
    function getBatchIncentive(uint256 batchSize)
        external
        view
        returns (bool canProcess, uint256 estimatedReward, uint256 remainingUsers)
    {
        if (!distributionState.active) return (false, 0, 0);
        if (keeperFeePool == 0) return (false, 0, 0);

        remainingUsers = activeUsers.length - distributionState.cursor;
        canProcess = remainingUsers > 0;

        // Estimate reward based on batch size (capped at remaining users)
        uint256 usersToProcess = batchSize > remainingUsers ? remainingUsers : batchSize;
        estimatedReward = (keeperFeePool * usersToProcess) / activeUsers.length;
    }

    /*//////////////////////////////////////////////////////////////
                        INTERNAL FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Swap DAI for BZZ using direct UniswapV3 pool swap
    /// @param daiAmount Amount of DAI to swap
    /// @return bzzAmount Amount of BZZ received
    function _swapDAIForBZZ(uint256 daiAmount) internal returns (uint256 bzzAmount) {
        // Pool: token0 = BZZ (0xdBF3...), token1 = WXDAI (0xe91D...)
        // We want WXDAI -> BZZ, which is token1 -> token0, so zeroForOne = false
        IUniswapV3Pool pool = IUniswapV3Pool(bzzWxdaiPool);

        // Store BZZ balance before swap
        uint256 bzzBefore = BZZ.balanceOf(address(this));

        // sqrtPriceLimitX96 for token1 -> token0 swap (price going up)
        // Use max price limit (we rely on slippage check instead)
        uint160 sqrtPriceLimitX96 = 1461446703485210103287273052203988822378723970341;

        // Execute swap - pool will call uniswapV3SwapCallback
        // amountSpecified > 0 means exactInput (we specify how much DAI to swap)
        pool.swap(
            address(this), // recipient
            false, // zeroForOne = false (token1 -> token0, i.e., WXDAI -> BZZ)
            int256(daiAmount), // amountSpecified (positive = exact input)
            sqrtPriceLimitX96, // price limit
            abi.encode(daiAmount) // callback data
        );

        // Calculate actual BZZ received
        bzzAmount = BZZ.balanceOf(address(this)) - bzzBefore;

        // Slippage protection: ensure we got at least 1% of input value
        // This is very conservative - actual swap should give much more based on pool price
        uint256 minBZZ = daiAmount / 100;
        if (bzzAmount < minBZZ) revert SlippageTooHigh();
    }

    /// @notice UniswapV3 swap callback - called by pool to receive payment
    /// @param amount0Delta The amount of token0 that was sent (negative) or must be received (positive)
    /// @param amount1Delta The amount of token1 that was sent (negative) or must be received (positive)
    /// @param data Callback data containing expected DAI amount
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        // Verify caller is the pool
        if (msg.sender != bzzWxdaiPool) revert ZeroAddress();

        // We're swapping token1 (WXDAI) for token0 (BZZ)
        // amount1Delta should be positive (we owe WXDAI to the pool)
        if (amount1Delta <= 0) revert ZeroAmount();

        // Decode expected amount for safety check
        uint256 expectedAmount = abi.decode(data, (uint256));

        // Pay the pool
        uint256 amountToPay = uint256(amount1Delta);

        // Safety check: don't pay more than expected
        if (amountToPay > expectedAmount) revert SlippageTooHigh();

        DAI.safeTransfer(msg.sender, amountToPay);
    }

    /// @notice Add user to active users list
    function _addActiveUser(address user) internal {
        if (activeUserIndex[user] == 0) {
            activeUsers.push(user);
            activeUserIndex[user] = activeUsers.length; // 1-based index
        }
    }

    /// @notice Remove user from active users list
    function _removeActiveUser(address user) internal {
        uint256 index = activeUserIndex[user];
        if (index == 0) return; // Not in list

        // Convert to 0-based
        index = index - 1;

        // Swap with last element
        uint256 lastIndex = activeUsers.length - 1;
        if (index != lastIndex) {
            address lastUser = activeUsers[lastIndex];
            activeUsers[index] = lastUser;
            activeUserIndex[lastUser] = index + 1; // Update to 1-based
        }

        // Remove last element
        activeUsers.pop();
        delete activeUserIndex[user];
    }

    /// @notice Get total sDAI for a user across all deposits
    function _getUserTotalSDAI(address user) internal view returns (uint256 total) {
        Deposit[] storage deposits = userDeposits[user];
        for (uint256 i = 0; i < deposits.length; i++) {
            total += deposits[i].sDAIAmount;
        }
    }

    /*//////////////////////////////////////////////////////////////
                        ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Update V3 Swap Router
    /// @param _newRouter New RouteProcessor2 address
    function setRouteProcessor(address _newRouter) external onlyOwner {
        if (_newRouter == address(0)) revert ZeroAddress();
        routeProcessor = IRouteProcessor2(_newRouter);
    }

    /// @notice Update BZZ/WXDAI pool address
    /// @param _newPool New pool address
    function setBzzWxdaiPool(address _newPool) external onlyOwner {
        if (_newPool == address(0)) revert ZeroAddress();
        bzzWxdaiPool = _newPool;
    }

    /// @notice Update maximum slippage tolerance
    /// @param _slippageBps New slippage in basis points (e.g., 500 = 5%)
    function setMaxSlippageBps(uint256 _slippageBps) external onlyOwner {
        require(_slippageBps <= 1000, "Slippage too high"); // Max 10%
        maxSlippageBps = _slippageBps;
    }

    /// @notice Update minimum yield threshold
    /// @param _threshold New threshold in DAI
    function setMinYieldThreshold(uint256 _threshold) external onlyOwner {
        minYieldThreshold = _threshold;
    }

    /// @notice Update harvester fee percentage
    /// @param _feeBps New fee in basis points
    function setHarvesterFee(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 200, "Fee too high"); // Max 2%
        harvesterFeeBps = _feeBps;
        emit HarvesterFeeUpdated(_feeBps);
    }

    /// @notice Update keeper fee percentage
    /// @param _feeBps New fee in basis points
    function setKeeperFee(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 500, "Fee too high"); // Max 5%
        keeperFeeBps = _feeBps;
        emit KeeperFeeUpdated(_feeBps);
    }

    /// @notice Get number of active users
    function getActiveUserCount() external view returns (uint256) {
        return activeUsers.length;
    }

    /// @notice Get user's deposit count
    /// @param user User address
    /// @return count Number of deposits
    function getUserDepositCount(address user) external view returns (uint256 count) {
        return userDeposits[user].length;
    }

    /// @notice Get user's deposit details
    /// @param user User address
    /// @param depositIndex Deposit index
    /// @return userDeposit Deposit struct
    function getUserDeposit(address user, uint256 depositIndex) external view returns (Deposit memory userDeposit) {
        if (depositIndex >= userDeposits[user].length) {
            revert InvalidDepositIndex();
        }
        return userDeposits[user][depositIndex];
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[50] private __gap;
}
