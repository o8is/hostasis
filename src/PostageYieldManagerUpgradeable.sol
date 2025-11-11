// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {ISavingsDai} from "./interfaces/ISavingsDai.sol";
import {IPostageStamp} from "./interfaces/IPostageStamp.sol";
import {IDexRouter} from "./interfaces/IDexRouter.sol";

/// @title PostageYieldManagerUpgradeable
/// @notice Manages sDAI deposits and redirects yield to Swarm postage stamps (Upgradeable)
/// @dev Correctly tracks principal in DAI terms to prevent yield theft between depositors
contract PostageYieldManagerUpgradeable is
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardTransient
{
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

    /// @notice DEX router for swapping DAI -> BZZ
    IDexRouter public dexRouter;

    /// @notice Minimum yield threshold before harvest (in DAI)
    uint256 public minYieldThreshold;

    /// @notice Maximum slippage tolerance in basis points (e.g., 100 = 1%)
    uint256 public maxSlippageBps;

    /// @notice Struct representing a user's deposit
    struct Deposit {
        uint256 sDAIAmount; // Amount of sDAI shares deposited
        uint256 principalDAI; // DAI value at time of deposit (prevents yield theft)
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

    /// @notice Distribution state
    struct DistributionState {
        uint256 totalBZZ; // Total BZZ to distribute
        uint256 cursor; // Current position in activeUsers array
        uint256 snapshotTotalSDAI; // Total sDAI at time of harvest
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

    function initialize(address _sdai, address _dai, address _bzz, address _postageStamp, address _dexRouter)
        public
        initializer
    {
        if (_sdai == address(0)) revert ZeroAddress();
        if (_dai == address(0)) revert ZeroAddress();
        if (_bzz == address(0)) revert ZeroAddress();
        if (_postageStamp == address(0)) revert ZeroAddress();
        if (_dexRouter == address(0)) revert ZeroAddress();

        __Ownable_init(msg.sender);
        // Note: ReentrancyGuardTransient and UUPSUpgradeable don't need initialization

        SDAI = ISavingsDai(_sdai);
        DAI = IERC20(_dai);
        BZZ = IERC20(_bzz);
        POSTAGE_STAMP = IPostageStamp(_postageStamp);
        dexRouter = IDexRouter(_dexRouter);

        minYieldThreshold = 0.25e18; // 0.25 DAI minimum
        maxSlippageBps = 200; // 2% max slippage
        harvesterFeeBps = 50; // 0.5% harvester fee
        keeperFeeBps = 100; // 1% keeper fee
        lastHarvestTime = block.timestamp;
    }

    /*//////////////////////////////////////////////////////////////
                        UPGRADE AUTHORIZATION
    //////////////////////////////////////////////////////////////*/

    /// @notice Authorize upgrade (only owner can upgrade)
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

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
            Deposit({sDAIAmount: sDAIAmount, principalDAI: daiValue, stampId: stampId, depositTime: block.timestamp})
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
            Deposit({sDAIAmount: sDAIAmount, principalDAI: daiValue, stampId: stampId, depositTime: block.timestamp})
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
        if (depositIndex >= userDeposits[msg.sender].length) revert InvalidDepositIndex();
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
        if (depositIndex >= userDeposits[msg.sender].length) revert InvalidDepositIndex();
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
        if (depositIndex >= userDeposits[msg.sender].length) revert InvalidDepositIndex();
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
        if (depositIndex >= userDeposits[msg.sender].length) revert InvalidDepositIndex();
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
    /// @dev Swaps (yield - harvester fee - keeper fees) to BZZ, sets up or adds to batch distribution
    /// @dev Can be called multiple times to accumulate fees before keeper processes batches
    function harvest() external nonReentrant {
        uint256 totalYield = previewYield();
        if (totalYield == 0) revert NoYieldAvailable();
        if (totalYield < minYieldThreshold) revert NotEnoughYieldAvailable();

        // Calculate sDAI shares representing the yield
        uint256 currentRate = SDAI.convertToAssets(1e18);
        uint256 yieldShares = (totalYield * 1e18) / currentRate;

        // Take snapshot BEFORE updating totalSDAI for correct distribution calculations
        // If distribution already active, accumulate BZZ; otherwise start new distribution
        // We must snapshot before modifying totalSDAI so user deposits align with snapshot
        if (!distributionState.active) {
            // Setup new distribution state - snapshot current totalSDAI before harvest
            distributionState = DistributionState({
                totalBZZ: 0, // Will be set after swap
                cursor: 0,
                snapshotTotalSDAI: totalSDAI, // Snapshot BEFORE removing yield
                active: true
            });
        }

        // Update accounting (before redeeming)
        totalSDAI -= yieldShares;
        // Recalculate principal for remaining shares at current rate
        totalPrincipalDAI = (totalSDAI * currentRate) / 1e18;

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

        // Add BZZ to distribution (either new or accumulating)
        if (distributionState.active) {
            // Add to distribution pool (works for both new distributions and accumulations)
            distributionState.totalBZZ += bzzReceived;
        }

        lastHarvestTime = block.timestamp;

        emit YieldHarvested(totalYield, bzzReceived, block.timestamp);
    }

    /// @notice Process a batch of distributions (permissionless)
    /// @param batchSize Number of users to process in this batch
    /// @dev Anyone can call this to earn keeper fees proportional to work done
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

                // Calculate this deposit's share of total BZZ (using snapshot)
                uint256 bzzShare = (state.totalBZZ * dep.sDAIAmount) / state.snapshotTotalSDAI;

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

    /// @notice Swap DAI for BZZ on Gnosis DEX
    /// @param daiAmount Amount of DAI to swap
    /// @return bzzAmount Amount of BZZ received
    function _swapDAIForBZZ(uint256 daiAmount) internal returns (uint256 bzzAmount) {
        // Approve DEX router
        DAI.safeIncreaseAllowance(address(dexRouter), daiAmount);

        // Create swap path: DAI -> BZZ
        address[] memory path = new address[](2);
        path[0] = address(DAI);
        path[1] = address(BZZ);

        // Get expected output
        uint256[] memory amountsOut = dexRouter.getAmountsOut(daiAmount, path);
        uint256 expectedBZZ = amountsOut[1];

        // Calculate minimum output with slippage protection
        uint256 minBZZ = (expectedBZZ * (10000 - maxSlippageBps)) / 10000;

        // Execute swap
        uint256[] memory amounts = dexRouter.swapExactTokensForTokens(
            daiAmount,
            minBZZ,
            path,
            address(this),
            block.timestamp + 300 // 5 minute deadline
        );

        bzzAmount = amounts[1];
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

    /// @notice Update DEX router
    /// @param _newRouter New router address
    function setDexRouter(address _newRouter) external onlyOwner {
        if (_newRouter == address(0)) revert ZeroAddress();
        dexRouter = IDexRouter(_newRouter);
    }

    /// @notice Update minimum yield threshold
    /// @param _threshold New threshold in DAI
    function setMinYieldThreshold(uint256 _threshold) external onlyOwner {
        minYieldThreshold = _threshold;
    }

    /// @notice Update maximum slippage tolerance
    /// @param _slippageBps New slippage in basis points
    function setMaxSlippage(uint256 _slippageBps) external onlyOwner {
        maxSlippageBps = _slippageBps;
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
        if (depositIndex >= userDeposits[user].length) revert InvalidDepositIndex();
        return userDeposits[user][depositIndex];
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[50] private __gap;
}
