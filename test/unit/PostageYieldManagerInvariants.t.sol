// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {PostageYieldManagerUpgradeable} from "../../src/PostageYieldManagerUpgradeable.sol";
import {MockSavingsDai} from "../mocks/MockSavingsDai.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPostageStamp} from "../mocks/MockPostageStamp.sol";
import {MockUniswapV3Pool} from "../mocks/MockUniswapV3Pool.sol";
import {UnsafeUpgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";

/**
 * @title PostageYieldManagerInvariantTest
 * @notice Property-based invariant tests for PostageYieldManager
 * @dev These tests ensure critical mathematical properties hold across all operations:
 *      1. Contract solvency (balance >= user deposits)
 *      2. Accounting conservation (sum of deposits = totalSDAI)
 *      3. Dust non-negativity (contract holds excess, not deficit)
 *      4. Ceiling rounding correctness
 */
contract PostageYieldManagerInvariantTest is StdInvariant, Test {
    PostageYieldManagerUpgradeable public manager;
    MockSavingsDai public sdai;
    MockERC20 public dai;
    MockERC20 public bzz;
    MockPostageStamp public postageStamp;
    MockUniswapV3Pool public mockPool;

    InvariantHandler public handler;

    address public admin = address(0x999);

    function setUp() public {
        // Deploy mocks
        dai = new MockERC20("DAI", "DAI", 18);
        bzz = new MockERC20("BZZ", "BZZ", 18);
        sdai = new MockSavingsDai(address(dai), 1e18); // 1:1 initial rate
        postageStamp = new MockPostageStamp();

        // Create mock pool (1 DAI = 2 BZZ)
        mockPool = new MockUniswapV3Pool(address(bzz), address(dai), 56022498816034085568);
        mockPool.setMockRate(2e18);
        bzz.mint(address(mockPool), 1000000e18);

        // Deploy manager
        address implementation = address(new PostageYieldManagerUpgradeable());
        address proxy = UnsafeUpgrades.deployTransparentProxy(
            implementation,
            admin,
            abi.encodeCall(
                PostageYieldManagerUpgradeable.initialize,
                (
                    address(sdai),
                    address(dai),
                    address(bzz),
                    address(postageStamp),
                    address(1), // routeProcessor (deprecated)
                    address(mockPool)
                )
            )
        );
        manager = PostageYieldManagerUpgradeable(proxy);

        // Deploy handler
        handler = new InvariantHandler(manager, sdai, dai, postageStamp);

        // Target handler for invariant testing
        targetContract(address(handler));

        // Only call handler functions
        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = InvariantHandler.deposit.selector;
        selectors[1] = InvariantHandler.withdraw.selector;
        selectors[2] = InvariantHandler.generateYield.selector;
        selectors[3] = InvariantHandler.harvestAndDistribute.selector;

        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /*//////////////////////////////////////////////////////////////
                        CORE INVARIANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Invariant 1: Contract sDAI balance must always cover totalSDAI
    /// @dev This ensures contract solvency - users can always withdraw
    function invariant_contractBalanceCoversDeposits() public view {
        uint256 contractBalance = sdai.balanceOf(address(manager));
        uint256 totalDeposits = manager.totalSDAI();

        assertGe(contractBalance, totalDeposits, "Contract balance must be >= totalSDAI (solvency)");
    }

    /// @notice Invariant 2: Dust (excess balance) must be non-negative
    /// @dev Ceiling rounding ensures contract holds >= user deposits, never less
    function invariant_dustIsNonNegative() public view {
        uint256 contractBalance = sdai.balanceOf(address(manager));
        uint256 totalDeposits = manager.totalSDAI();

        // This should never underflow due to invariant_contractBalanceCoversDeposits
        uint256 dust = contractBalance - totalDeposits;

        assertGe(dust, 0, "Dust must be non-negative");
    }

    /// @notice Invariant 3: Sum of individual deposits equals totalSDAI (with rounding tolerance)
    /// @dev Accounting conservation - no sDAI created or destroyed
    /// Due to ceiling rounding in processBatch, there may be small rounding differences
    /// where deposit reductions are slightly larger than expected (dust accumulates in contract)
    function invariant_accountingConservation() public view {
        uint256 sumOfDeposits = handler.sumOfAllDeposits();
        uint256 totalSDAI = manager.totalSDAI();

        // Calculate absolute difference
        uint256 diff;
        if (totalSDAI >= sumOfDeposits) {
            diff = totalSDAI - sumOfDeposits;
        } else {
            diff = sumOfDeposits - totalSDAI;
        }

        // Allow up to 1 wei per depositor per harvest as rounding tolerance
        // This accounts for ceiling rounding in yield distribution
        uint256 numHarvests = handler.harvestCount();
        uint256 maxDeposits = handler.depositCount(); // Upper bound on depositors
        uint256 maxDiff = (numHarvests + 1) * (maxDeposits + 1); // Conservative bound

        assertLe(diff, maxDiff, "Accounting difference exceeds rounding tolerance");
    }

    /// @notice Invariant 4: Dust accumulation is bounded per Theorem 2
    /// @dev Maximum dust per harvest is (N-1) where N = number of active depositors
    function invariant_dustIsBounded() public view {
        uint256 contractBalance = sdai.balanceOf(address(manager));
        uint256 totalDeposits = manager.totalSDAI();
        uint256 dust = contractBalance - totalDeposits;

        uint256 numHarvests = handler.harvestCount();
        uint256 maxActiveDepositors = handler.maxActiveDepositors();

        // Theoretical maximum: (N-1) wei per harvest
        // Adding some buffer for edge cases
        uint256 maxExpectedDust = numHarvests * maxActiveDepositors;

        assertLe(dust, maxExpectedDust, "Dust accumulation must be bounded by harvest count * depositors");
    }

    /// @notice Invariant 5: Total principal DAI conservation
    /// @dev Principal DAI should equal sum of user principal values
    function invariant_principalConservation() public view {
        uint256 sumOfPrincipals = handler.sumOfAllPrincipals();
        uint256 totalPrincipal = manager.totalPrincipalDAI();

        assertEq(sumOfPrincipals, totalPrincipal, "Sum of individual principals must equal totalPrincipalDAI");
    }

    /// @notice Invariant 6: No negative deposits
    /// @dev All tracked deposits should have non-negative sDAI amounts
    function invariant_noNegativeDeposits() public view {
        // Handler tracks all deposits and verifies none are negative
        assertTrue(handler.allDepositsNonNegative(), "All deposits must have non-negative sDAI amounts");
    }

    /*//////////////////////////////////////////////////////////////
                        CALL SUMMARY
    //////////////////////////////////////////////////////////////*/

    /// @notice Log call summary after invariant testing
    function invariant_callSummary() public view {
        console.log("\n=== Invariant Test Summary ===");
        console.log("Total deposits:", handler.depositCount());
        console.log("Total withdrawals:", handler.withdrawCount());
        console.log("Total harvests:", handler.harvestCount());
        console.log("Total yield generated:", handler.totalYieldGenerated());
        console.log("Max active depositors:", handler.maxActiveDepositors());
        console.log("Current contract balance:", sdai.balanceOf(address(manager)));
        console.log("Current totalSDAI:", manager.totalSDAI());
        console.log("Current dust:", sdai.balanceOf(address(manager)) - manager.totalSDAI());
    }
}

/**
 * @title InvariantHandler
 * @notice Handler contract for invariant testing
 * @dev Provides controlled functions for fuzzer to call, tracking state for invariants
 */
contract InvariantHandler is Test {
    PostageYieldManagerUpgradeable public manager;
    MockSavingsDai public sdai;
    MockERC20 public dai;
    MockPostageStamp public postageStamp;

    // Tracking state
    uint256 public depositCount;
    uint256 public withdrawCount;
    uint256 public harvestCount;
    uint256 public totalYieldGenerated;
    uint256 public maxActiveDepositors;

    // Actor management
    address[] public actors;
    mapping(address => bool) public isActor;
    mapping(address => bytes32) public actorStamp;
    mapping(address => uint256[]) public actorDepositIndices;

    uint256 private constant MAX_ACTORS = 10;
    uint256 private constant MIN_DEPOSIT = 1e18;
    uint256 private constant MAX_DEPOSIT = 1000e18;

    constructor(
        PostageYieldManagerUpgradeable _manager,
        MockSavingsDai _sdai,
        MockERC20 _dai,
        MockPostageStamp _postageStamp
    ) {
        manager = _manager;
        sdai = _sdai;
        dai = _dai;
        postageStamp = _postageStamp;
    }

    /*//////////////////////////////////////////////////////////////
                        HANDLER ACTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Deposit sDAI into the manager
    function deposit(uint256 actorSeed, uint256 amount) public {
        // Get or create actor
        address actor = _getOrCreateActor(actorSeed);

        // Bound amount
        amount = bound(amount, MIN_DEPOSIT, MAX_DEPOSIT);

        // Mint sDAI to actor if needed
        uint256 actorBalance = sdai.balanceOf(actor);
        if (actorBalance < amount) {
            uint256 daiNeeded = amount - actorBalance;
            dai.mint(actor, daiNeeded);
            vm.startPrank(actor);
            dai.approve(address(sdai), daiNeeded);
            sdai.deposit(daiNeeded, actor);
            vm.stopPrank();
        }

        // Deposit
        vm.startPrank(actor);
        sdai.approve(address(manager), amount);

        uint256 depositIdx = manager.getUserDepositCount(actor);
        try manager.deposit(amount, actorStamp[actor]) {
            depositCount++;
            actorDepositIndices[actor].push(depositIdx);

            // Track max active depositors
            uint256 activeCount = _countActiveDepositors();
            if (activeCount > maxActiveDepositors) {
                maxActiveDepositors = activeCount;
            }
        } catch {
            // Deposit failed, that's ok for fuzzing
        }
        vm.stopPrank();
    }

    /// @notice Withdraw sDAI from the manager
    function withdraw(uint256 actorSeed, uint256 amountSeed) public {
        if (actors.length == 0) return;

        address actor = actors[actorSeed % actors.length];
        uint256[] memory depositIndices = actorDepositIndices[actor];
        if (depositIndices.length == 0) return;

        // Pick a random deposit
        uint256 depositIdx = depositIndices[actorSeed % depositIndices.length];

        // Get deposit info
        try manager.getUserDeposit(actor, depositIdx) returns (PostageYieldManagerUpgradeable.Deposit memory dep) {
            uint256 sDAIAmount = dep.sDAIAmount;
            if (sDAIAmount == 0) return; // No deposit to withdraw

            // Bound withdrawal amount (0 means full withdrawal)
            uint256 withdrawAmount;
            if (amountSeed % 3 == 0) {
                withdrawAmount = 0; // Full withdrawal
            } else {
                withdrawAmount = bound(amountSeed, 1, sDAIAmount);
            }

            vm.prank(actor);
            try manager.withdraw(depositIdx, withdrawAmount) {
                withdrawCount++;
            } catch {
                // Withdrawal failed, that's ok
            }
        } catch {
            // Deposit doesn't exist
        }
    }

    /// @notice Generate yield by changing sDAI exchange rate
    function generateYield(uint256 yieldPercentage) public {
        // Bound yield between 0.01% and 10%
        yieldPercentage = bound(yieldPercentage, 1, 1000); // 0.01% to 10%

        uint256 currentRate = sdai.convertToAssets(1e18);
        uint256 newRate = currentRate + (currentRate * yieldPercentage) / 10000;

        sdai.setExchangeRate(newRate);

        uint256 yield = (manager.totalSDAI() * yieldPercentage) / 10000;
        totalYieldGenerated += yield;
    }

    /// @notice Harvest and distribute yield
    function harvestAndDistribute() public {
        if (manager.totalSDAI() == 0) return;

        try manager.harvest() {
            harvestCount++;

            // Process distribution
            try manager.processBatch(100) {} catch {}
        } catch {
            // Harvest failed (e.g., no yield), that's ok
        }
    }

    /*//////////////////////////////////////////////////////////////
                        HELPER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function _getOrCreateActor(uint256 seed) internal returns (address) {
        if (actors.length > 0) {
            // 50% chance to reuse existing actor, 50% create new
            if (seed % 2 == 0 && actors.length < MAX_ACTORS) {
                return _createNewActor(seed);
            } else {
                return actors[seed % actors.length];
            }
        } else {
            return _createNewActor(seed);
        }
    }

    function _createNewActor(uint256 seed) internal returns (address) {
        address actor = address(uint160(seed));

        if (!isActor[actor]) {
            actors.push(actor);
            isActor[actor] = true;

            // Create stamp for actor
            bytes32 stampId = bytes32(uint256(uint160(actor)));
            actorStamp[actor] = stampId;
            postageStamp.createBatch(stampId);
        }

        return actor;
    }

    function _countActiveDepositors() internal view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < actors.length; i++) {
            uint256[] memory depositIndices = actorDepositIndices[actors[i]];
            for (uint256 j = 0; j < depositIndices.length; j++) {
                try manager.getUserDeposit(actors[i], depositIndices[j]) returns (
                    PostageYieldManagerUpgradeable.Deposit memory dep
                ) {
                    if (dep.sDAIAmount > 0) {
                        count++;
                        break; // Count each actor only once
                    }
                } catch {
                    // Skip
                }
            }
        }
        return count;
    }

    /*//////////////////////////////////////////////////////////////
                    INVARIANT HELPER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Calculate sum of all user deposits
    function sumOfAllDeposits() public view returns (uint256) {
        uint256 sum = 0;
        for (uint256 i = 0; i < actors.length; i++) {
            uint256[] memory depositIndices = actorDepositIndices[actors[i]];
            for (uint256 j = 0; j < depositIndices.length; j++) {
                try manager.getUserDeposit(actors[i], depositIndices[j]) returns (
                    PostageYieldManagerUpgradeable.Deposit memory dep
                ) {
                    sum += dep.sDAIAmount;
                } catch {
                    // Skip invalid deposits
                }
            }
        }
        return sum;
    }

    /// @notice Calculate sum of all user principals
    function sumOfAllPrincipals() public view returns (uint256) {
        uint256 sum = 0;
        for (uint256 i = 0; i < actors.length; i++) {
            uint256[] memory depositIndices = actorDepositIndices[actors[i]];
            for (uint256 j = 0; j < depositIndices.length; j++) {
                try manager.getUserDeposit(actors[i], depositIndices[j]) returns (
                    PostageYieldManagerUpgradeable.Deposit memory dep
                ) {
                    sum += dep.principalDAI;
                } catch {
                    // Skip invalid deposits
                }
            }
        }
        return sum;
    }

    /// @notice Check if all deposits have non-negative sDAI amounts
    function allDepositsNonNegative() public view returns (bool) {
        for (uint256 i = 0; i < actors.length; i++) {
            uint256[] memory depositIndices = actorDepositIndices[actors[i]];
            for (uint256 j = 0; j < depositIndices.length; j++) {
                try manager.getUserDeposit(actors[i], depositIndices[j]) returns (
                    PostageYieldManagerUpgradeable.Deposit memory dep
                ) {
                    // sDAIAmount is uint256, so it's always >= 0
                    // But we check to ensure no weird overflow issues
                    if (dep.sDAIAmount > type(uint256).max / 2) {
                        return false; // Suspiciously large value
                    }
                } catch {
                    // Skip invalid deposits
                }
            }
        }
        return true;
    }
}
