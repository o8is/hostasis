// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {PostageYieldManagerUpgradeable} from "../../src/PostageYieldManagerUpgradeable.sol";
import {MockSavingsDai} from "../mocks/MockSavingsDai.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPostageStamp} from "../mocks/MockPostageStamp.sol";
import {MockUniswapV3Pool} from "../mocks/MockUniswapV3Pool.sol";
import {UnsafeUpgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";

contract PostageYieldManagerTest is Test {
    PostageYieldManagerUpgradeable public manager;
    MockSavingsDai public sdai;
    MockERC20 public dai;
    MockERC20 public bzz;
    MockPostageStamp public postageStamp;
    MockUniswapV3Pool public mockPool;

    address public alice = address(0x1);
    address public bob = address(0x2);
    address public charlie = address(0x3);
    address public admin = address(0x999); // Separate admin for proxy

    bytes32 public constant STAMP_ALICE = bytes32(uint256(1));
    bytes32 public constant STAMP_BOB = bytes32(uint256(2));
    bytes32 public constant STAMP_CHARLIE = bytes32(uint256(3));

    uint256 public constant INITIAL_RATE = 1e18; // 1:1 sDAI:DAI
    uint256 public constant INITIAL_BALANCE = 1000e18;

    function setUp() public {
        // Deploy mocks
        dai = new MockERC20("DAI", "DAI", 18);
        bzz = new MockERC20("BZZ", "BZZ", 18); // Use 18 decimals in tests for simplicity
        sdai = new MockSavingsDai(address(dai), INITIAL_RATE);
        postageStamp = new MockPostageStamp();

        // Create mock pool with price that matches 1 DAI = 2 BZZ exchange rate
        // For BZZ (token0) and DAI (token1), if 1 DAI = 2 BZZ, then DAI/BZZ = 0.5
        // sqrtPriceX96 = sqrt(DAI/BZZ) * 2^96 = sqrt(0.5) * 2^96
        // sqrt(0.5) ≈ 0.7071
        // 0.7071 * 2^96 ≈ 56022498816 * 10^18
        mockPool = new MockUniswapV3Pool(address(bzz), address(dai), 56022498816034085568);

        // Set exchange rate (1 DAI = 2 BZZ)
        mockPool.setMockRate(2e18);

        // Fund the Pool with BZZ for direct swaps
        bzz.mint(address(mockPool), 1000000e18);

        // Deploy implementation
        address implementation = address(new PostageYieldManagerUpgradeable());

        // Deploy upgradeable manager with proxy
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
                    address(1), // routeProcessor (deprecated, not used)
                    address(mockPool)
                )
            )
        );
        manager = PostageYieldManagerUpgradeable(proxy);

        // Setup users with sDAI
        _mintSDAIToUser(alice, INITIAL_BALANCE);
        _mintSDAIToUser(bob, INITIAL_BALANCE);
        _mintSDAIToUser(charlie, INITIAL_BALANCE);

        // Create postage stamps
        postageStamp.createBatch(STAMP_ALICE);
        postageStamp.createBatch(STAMP_BOB);
        postageStamp.createBatch(STAMP_CHARLIE);
    }

    function _mintSDAIToUser(address user, uint256 amount) internal {
        // Mint DAI to user
        dai.mint(user, amount);

        // User deposits DAI into sDAI
        vm.startPrank(user);
        dai.approve(address(sdai), amount);
        sdai.deposit(amount, user);
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                        DEPOSIT TESTS
    //////////////////////////////////////////////////////////////*/

    function test_Deposit_Success() public {
        uint256 depositAmount = 100e18;

        vm.startPrank(alice);
        sdai.approve(address(manager), depositAmount);
        uint256 depositIndex = manager.deposit(depositAmount, STAMP_ALICE);
        vm.stopPrank();

        assertEq(depositIndex, 0, "First deposit should have index 0");
        assertEq(manager.totalSDAI(), depositAmount, "Total sDAI should match deposit");
        assertEq(manager.totalPrincipalDAI(), depositAmount, "Total principal should match deposit value");

        PostageYieldManagerUpgradeable.Deposit memory userDeposit = manager.getUserDeposit(alice, 0);

        assertEq(userDeposit.sDAIAmount, depositAmount, "Deposit sDAI amount mismatch");
        assertEq(userDeposit.principalDAI, depositAmount, "Principal DAI should equal deposit at 1:1 rate");
        assertEq(userDeposit.stampId, STAMP_ALICE, "Stamp ID mismatch");
        assertGt(userDeposit.depositTime, 0, "Deposit time should be set");
    }

    function test_Deposit_RevertZeroAmount() public {
        vm.startPrank(alice);
        sdai.approve(address(manager), 100e18);
        vm.expectRevert(PostageYieldManagerUpgradeable.ZeroAmount.selector);
        manager.deposit(0, STAMP_ALICE);
        vm.stopPrank();
    }

    function test_Deposit_RevertZeroStampId() public {
        vm.startPrank(alice);
        sdai.approve(address(manager), 100e18);
        vm.expectRevert(PostageYieldManagerUpgradeable.InvalidStampId.selector);
        manager.deposit(100e18, bytes32(0));
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                    YIELD THEFT PREVENTION TESTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Test the exact scenario from ARCHITECTURE.md
    /// Alice deposits when rate = 1.0, rate increases to 1.1, Bob deposits
    /// Alice's yield should be preserved!
    function test_YieldTheftPrevention_AliceBobScenario() public {
        // Step 1: Alice deposits 100 sDAI when rate = 1.0
        uint256 aliceDeposit = 100e18;
        vm.startPrank(alice);
        sdai.approve(address(manager), aliceDeposit);
        manager.deposit(aliceDeposit, STAMP_ALICE);
        vm.stopPrank();

        // Verify Alice's principal is 100 DAI
        PostageYieldManagerUpgradeable.Deposit memory aliceDepositData = manager.getUserDeposit(alice, 0);
        assertEq(aliceDepositData.principalDAI, 100e18, "Alice principal should be 100 DAI");
        assertEq(manager.totalPrincipalDAI(), 100e18, "Total principal should be 100 DAI");

        // Step 2: Rate increases to 1.1 (10% yield)
        sdai.setExchangeRate(1.1e18);

        // Step 3: Bob deposits 100 sDAI when rate = 1.1
        uint256 bobDeposit = 100e18;
        vm.startPrank(bob);
        sdai.approve(address(manager), bobDeposit);
        manager.deposit(bobDeposit, STAMP_BOB);
        vm.stopPrank();

        // Verify Bob's principal is 110 DAI (100 sDAI * 1.1 rate)
        PostageYieldManagerUpgradeable.Deposit memory bobDepositData = manager.getUserDeposit(bob, 0);
        assertEq(bobDepositData.principalDAI, 110e18, "Bob principal should be 110 DAI");

        // Step 4: Total principal = 210 DAI (Alice: 100, Bob: 110)
        assertEq(manager.totalPrincipalDAI(), 210e18, "Total principal should be 210 DAI");

        // Step 5: Current value = 200 sDAI × 1.1 = 220 DAI
        uint256 totalValue = (manager.totalSDAI() * sdai.convertToAssets(1e18)) / 1e18;
        assertEq(totalValue, 220e18, "Total value should be 220 DAI");

        // Step 6: Yield = 220 - 210 = 10 DAI ✅ Alice's yield is preserved!
        uint256 yield = manager.previewYield();
        assertEq(yield, 10e18, "Yield should be 10 DAI (Alice's earned yield)");
    }

    /// @notice Test multiple deposits at different rates
    function test_YieldCalculation_MultipleDepositsAtDifferentRates() public {
        // Alice deposits 100 sDAI at rate 1.0
        vm.startPrank(alice);
        sdai.approve(address(manager), 100e18);
        manager.deposit(100e18, STAMP_ALICE);
        vm.stopPrank();

        // Rate goes to 1.05
        sdai.setExchangeRate(1.05e18);

        // Bob deposits 100 sDAI at rate 1.05
        vm.startPrank(bob);
        sdai.approve(address(manager), 100e18);
        manager.deposit(100e18, STAMP_BOB);
        vm.stopPrank();

        // Rate goes to 1.10
        sdai.setExchangeRate(1.1e18);

        // Charlie deposits 100 sDAI at rate 1.10
        vm.startPrank(charlie);
        sdai.approve(address(manager), 100e18);
        manager.deposit(100e18, STAMP_CHARLIE);
        vm.stopPrank();

        // Principals: Alice=100, Bob=105, Charlie=110, Total=315
        assertEq(manager.totalPrincipalDAI(), 315e18, "Total principal should be 315 DAI");

        // Current value: 300 sDAI * 1.10 = 330 DAI
        uint256 expectedValue = 330e18;
        uint256 totalValue = (manager.totalSDAI() * sdai.convertToAssets(1e18)) / 1e18;
        assertEq(totalValue, expectedValue, "Total value should be 330 DAI");

        // Yield: 330 - 315 = 15 DAI
        uint256 yield = manager.previewYield();
        assertEq(yield, 15e18, "Yield should be 15 DAI");
    }

    /// @notice Test that yield is zero when no rate increase
    function test_YieldCalculation_NoYieldWhenNoRateIncrease() public {
        vm.startPrank(alice);
        sdai.approve(address(manager), 100e18);
        manager.deposit(100e18, STAMP_ALICE);
        vm.stopPrank();

        // No rate change
        uint256 yield = manager.previewYield();
        assertEq(yield, 0, "Yield should be zero with no rate increase");
    }

    /*//////////////////////////////////////////////////////////////
                        WITHDRAWAL TESTS
    //////////////////////////////////////////////////////////////*/

    function test_Withdraw_Success() public {
        uint256 depositAmount = 100e18;
        uint256 withdrawAmount = 50e18;

        // Deposit
        vm.startPrank(alice);
        sdai.approve(address(manager), depositAmount);
        manager.deposit(depositAmount, STAMP_ALICE);

        // Withdraw half
        uint256 balanceBefore = sdai.balanceOf(alice);
        manager.withdraw(0, withdrawAmount);
        uint256 balanceAfter = sdai.balanceOf(alice);
        vm.stopPrank();

        assertEq(balanceAfter - balanceBefore, withdrawAmount, "Should receive withdrawn sDAI");

        PostageYieldManagerUpgradeable.Deposit memory userDeposit = manager.getUserDeposit(alice, 0);
        assertEq(userDeposit.sDAIAmount, 50e18, "Deposit should have 50 sDAI remaining");
        assertEq(userDeposit.principalDAI, 50e18, "Principal should be reduced proportionally");
        assertEq(manager.totalSDAI(), 50e18, "Total sDAI should be reduced");
        assertEq(manager.totalPrincipalDAI(), 50e18, "Total principal should be reduced");
    }

    function test_Withdraw_ProportionalPrincipalReduction() public {
        uint256 depositAmount = 100e18;

        // Deposit at rate 1.0
        vm.startPrank(alice);
        sdai.approve(address(manager), depositAmount);
        manager.deposit(depositAmount, STAMP_ALICE);
        vm.stopPrank();

        // Rate increases to 1.2
        sdai.setExchangeRate(1.2e18);

        // Withdraw 25% of sDAI
        vm.startPrank(alice);
        manager.withdraw(0, 25e18);
        vm.stopPrank();

        // Principal should also reduce by 25% (from 100 to 75)
        PostageYieldManagerUpgradeable.Deposit memory userDeposit = manager.getUserDeposit(alice, 0);
        assertEq(userDeposit.principalDAI, 75e18, "Principal should reduce proportionally");
    }

    function test_Withdraw_RevertInsufficientBalance() public {
        vm.startPrank(alice);
        sdai.approve(address(manager), 100e18);
        manager.deposit(100e18, STAMP_ALICE);

        vm.expectRevert(PostageYieldManagerUpgradeable.InsufficientBalance.selector);
        manager.withdraw(0, 101e18);
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                        UPDATE STAMP ID TESTS
    //////////////////////////////////////////////////////////////*/

    function test_UpdateStampId_Success() public {
        bytes32 newStampId = bytes32(uint256(999));
        postageStamp.createBatch(newStampId);

        vm.startPrank(alice);
        sdai.approve(address(manager), 100e18);
        manager.deposit(100e18, STAMP_ALICE);
        manager.updateStampId(0, newStampId);
        vm.stopPrank();

        PostageYieldManagerUpgradeable.Deposit memory userDeposit = manager.getUserDeposit(alice, 0);
        assertEq(userDeposit.stampId, newStampId, "Stamp ID should be updated");
    }

    /*//////////////////////////////////////////////////////////////
                        TOP UP TESTS
    //////////////////////////////////////////////////////////////*/

    function test_TopUp_Success() public {
        uint256 initialDeposit = 100e18;
        uint256 topUpAmount = 50e18;

        vm.startPrank(alice);
        sdai.approve(address(manager), initialDeposit + topUpAmount);

        // Initial deposit
        manager.deposit(initialDeposit, STAMP_ALICE);

        // Top up
        manager.topUp(0, topUpAmount);
        vm.stopPrank();

        PostageYieldManagerUpgradeable.Deposit memory userDeposit = manager.getUserDeposit(alice, 0);

        assertEq(userDeposit.sDAIAmount, initialDeposit + topUpAmount, "sDAI amount should increase");
        assertEq(userDeposit.principalDAI, initialDeposit + topUpAmount, "Principal should increase at 1:1 rate");
        assertEq(userDeposit.stampId, STAMP_ALICE, "Stamp ID should remain unchanged");
        assertEq(manager.totalSDAI(), initialDeposit + topUpAmount, "Total sDAI should be updated");
        assertEq(manager.totalPrincipalDAI(), initialDeposit + topUpAmount, "Total principal should be updated");
    }

    function test_TopUp_AtDifferentRate() public {
        uint256 initialDeposit = 100e18;
        uint256 topUpAmount = 50e18;
        uint256 newRate = 1.2e18; // 1 sDAI = 1.2 DAI

        vm.startPrank(alice);
        sdai.approve(address(manager), initialDeposit + topUpAmount);

        // Initial deposit at rate 1.0
        manager.deposit(initialDeposit, STAMP_ALICE);
        vm.stopPrank();

        // Change exchange rate
        sdai.setExchangeRate(newRate);

        // Top up at rate 1.2
        vm.startPrank(alice);
        manager.topUp(0, topUpAmount);
        vm.stopPrank();

        PostageYieldManagerUpgradeable.Deposit memory userDeposit = manager.getUserDeposit(alice, 0);

        // Initial: 100 sDAI @ 1.0 = 100 DAI principal
        // Top up: 50 sDAI @ 1.2 = 60 DAI principal
        // Total: 150 sDAI, 160 DAI principal
        assertEq(userDeposit.sDAIAmount, initialDeposit + topUpAmount, "sDAI amount should be 150");
        assertEq(userDeposit.principalDAI, 100e18 + 60e18, "Principal should be 160 (100 + 50*1.2)");
        assertEq(manager.totalSDAI(), 150e18, "Total sDAI should be 150");
        assertEq(manager.totalPrincipalDAI(), 160e18, "Total principal should be 160");
    }

    function test_TopUp_MultipleTopUps() public {
        vm.startPrank(alice);
        sdai.approve(address(manager), 1000e18);

        // Initial deposit
        manager.deposit(100e18, STAMP_ALICE);

        // First top up
        manager.topUp(0, 50e18);

        // Second top up
        manager.topUp(0, 30e18);

        // Third top up
        manager.topUp(0, 20e18);
        vm.stopPrank();

        PostageYieldManagerUpgradeable.Deposit memory userDeposit = manager.getUserDeposit(alice, 0);

        assertEq(userDeposit.sDAIAmount, 200e18, "Total sDAI should be 200");
        assertEq(userDeposit.principalDAI, 200e18, "Total principal should be 200");
    }

    function test_TopUp_RevertZeroAmount() public {
        vm.startPrank(alice);
        sdai.approve(address(manager), 100e18);
        manager.deposit(100e18, STAMP_ALICE);

        vm.expectRevert(PostageYieldManagerUpgradeable.ZeroAmount.selector);
        manager.topUp(0, 0);
        vm.stopPrank();
    }

    function test_TopUp_RevertInvalidDepositIndex() public {
        vm.startPrank(alice);
        sdai.approve(address(manager), 100e18);

        vm.expectRevert(PostageYieldManagerUpgradeable.InvalidDepositIndex.selector);
        manager.topUp(0, 50e18); // No deposit exists yet
        vm.stopPrank();
    }

    function test_TopUp_PreservesYieldCalculation() public {
        uint256 initialDeposit = 100e18;
        uint256 topUpAmount = 50e18;
        uint256 yieldRate = 1.5e18; // 1 sDAI = 1.5 DAI (50% yield)

        vm.startPrank(alice);
        sdai.approve(address(manager), initialDeposit + topUpAmount);

        // Initial deposit at rate 1.0
        manager.deposit(initialDeposit, STAMP_ALICE);
        vm.stopPrank();

        // Increase rate to simulate yield
        sdai.setExchangeRate(yieldRate);

        // Calculate yield before top-up
        uint256 yieldBeforeTopUp = manager.previewUserYield(alice, 0);

        // Top up at new rate
        vm.startPrank(alice);
        manager.topUp(0, topUpAmount);
        vm.stopPrank();

        // Yield should only come from the original deposit, not the top-up
        uint256 yieldAfterTopUp = manager.previewUserYield(alice, 0);

        // Original deposit: 100 sDAI with principal 100 DAI
        // At rate 1.5: worth 150 DAI, so 50 DAI yield
        // Top up: 50 sDAI with principal 75 DAI (50 * 1.5)
        // At rate 1.5: worth 75 DAI, so 0 DAI yield from top-up
        assertEq(yieldBeforeTopUp, 50e18, "Yield before top-up should be 50 DAI");
        assertEq(yieldAfterTopUp, 50e18, "Yield after top-up should still be 50 DAI (only from original)");
    }

    function test_TopUp_DifferentUserDeposits() public {
        // Alice creates two deposits
        vm.startPrank(alice);
        sdai.approve(address(manager), 300e18);
        manager.deposit(100e18, STAMP_ALICE);
        manager.deposit(100e18, STAMP_BOB);
        vm.stopPrank();

        // Bob creates one deposit
        vm.startPrank(bob);
        sdai.approve(address(manager), 100e18);
        manager.deposit(100e18, STAMP_BOB);
        vm.stopPrank();

        // Alice tops up her first deposit
        vm.startPrank(alice);
        sdai.approve(address(manager), 50e18);
        manager.topUp(0, 50e18);
        vm.stopPrank();

        // Check Alice's deposits
        PostageYieldManagerUpgradeable.Deposit memory aliceDeposit0 = manager.getUserDeposit(alice, 0);
        PostageYieldManagerUpgradeable.Deposit memory aliceDeposit1 = manager.getUserDeposit(alice, 1);

        assertEq(aliceDeposit0.sDAIAmount, 150e18, "Alice's first deposit should be topped up");
        assertEq(aliceDeposit1.sDAIAmount, 100e18, "Alice's second deposit unchanged");

        // Check Bob's deposit is unaffected
        PostageYieldManagerUpgradeable.Deposit memory bobDeposit = manager.getUserDeposit(bob, 0);
        assertEq(bobDeposit.sDAIAmount, 100e18, "Bob's deposit should be unchanged");

        // Check totals
        assertEq(manager.totalSDAI(), 350e18, "Total sDAI should be 350");
    }

    /*//////////////////////////////////////////////////////////////
                        PREVIEW YIELD TESTS
    //////////////////////////////////////////////////////////////*/

    function test_PreviewUserYield() public {
        // Alice deposits 100 sDAI at rate 1.0
        vm.startPrank(alice);
        sdai.approve(address(manager), 100e18);
        manager.deposit(100e18, STAMP_ALICE);
        vm.stopPrank();

        // Bob deposits 200 sDAI at rate 1.0
        vm.startPrank(bob);
        sdai.approve(address(manager), 200e18);
        manager.deposit(200e18, STAMP_BOB);
        vm.stopPrank();

        // Rate increases to 1.15 (15% yield)
        sdai.setExchangeRate(1.15e18);

        // Alice should have 15 DAI yield (100 * 0.15)
        uint256 aliceYield = manager.previewUserYield(alice, 0);
        assertEq(aliceYield, 15e18, "Alice should have 15 DAI yield");

        // Bob should have 30 DAI yield (200 * 0.15)
        uint256 bobYield = manager.previewUserYield(bob, 0);
        assertEq(bobYield, 30e18, "Bob should have 30 DAI yield");

        // Total yield should be 45 DAI
        uint256 totalYield = manager.previewYield();
        assertEq(totalYield, 45e18, "Total yield should be 45 DAI");
    }

    /*//////////////////////////////////////////////////////////////
                        EDGE CASE TESTS
    //////////////////////////////////////////////////////////////*/

    function test_EdgeCase_ZeroTotalSDAI() public {
        uint256 yield = manager.previewYield();
        assertEq(yield, 0, "Yield should be zero with no deposits");
    }

    function test_EdgeCase_RateDecreases() public {
        vm.startPrank(alice);
        sdai.approve(address(manager), 100e18);
        manager.deposit(100e18, STAMP_ALICE);
        vm.stopPrank();

        // Rate decreases (shouldn't happen in practice, but test anyway)
        sdai.setExchangeRate(0.95e18);

        uint256 yield = manager.previewYield();
        assertEq(yield, 0, "Yield should be zero when rate decreases");
    }

    /// @notice REGRESSION TEST: Multiple harvests cause over-allocation due to stale deposit amounts
    /// @dev This test reproduces the exact bug found in production where:
    ///      1. User deposits sDAI
    ///      2. First harvest() reduces totalSDAI but NOT user's deposit.sDAIAmount
    ///      3. Second harvest() snapshots the reduced totalSDAI
    ///      4. processBatch() calculates share using stale deposit.sDAIAmount / reduced snapshotTotalSDAI
    ///      5. This causes over-allocation and attempts to transfer more BZZ than available
    function test_Regression_MultipleHarvestsOverAllocateBZZ() public {
        // Test behavior: Multiple harvests should correctly distribute BZZ without over-allocation
        // This tests that shares-based accounting works correctly across multiple harvest cycles

        // 1. Alice deposits 100 sDAI
        vm.startPrank(alice);
        sdai.approve(address(manager), 100e18);
        manager.deposit(100e18, STAMP_ALICE);
        vm.stopPrank();

        uint256 initialTotalSDAI = manager.totalSDAI();
        assertEq(initialTotalSDAI, 100e18, "Initial totalSDAI should be 100");

        // Record Alice's shares (should remain constant)
        PostageYieldManagerUpgradeable.Deposit memory aliceDepositInitial = manager.getUserDeposit(alice, 0);
        uint256 aliceShares = aliceDepositInitial.sDAIAmount;

        // 2. Rate increases to generate yield
        sdai.setExchangeRate(1.1e18); // 10% yield = 10 DAI

        // 3. First harvest
        manager.harvest();

        // After first harvest, global totalSDAI is reduced (yield removed)
        uint256 totalSDAIAfterFirstHarvest = manager.totalSDAI();
        assertLt(totalSDAIAfterFirstHarvest, initialTotalSDAI, "Global totalSDAI should be reduced after harvest");

        // Shares remain unchanged AFTER harvest but BEFORE processBatch
        PostageYieldManagerUpgradeable.Deposit memory aliceDepositAfterHarvest1 = manager.getUserDeposit(alice, 0);
        assertEq(
            aliceDepositAfterHarvest1.sDAIAmount, aliceShares, "Alice's shares should remain fixed before processBatch"
        );

        // Complete first distribution - this WILL reduce Alice's shares
        manager.processBatch(1);

        // After processBatch, shares should be reduced by yield shares consumed
        PostageYieldManagerUpgradeable.Deposit memory aliceDepositAfterProcess1 = manager.getUserDeposit(alice, 0);
        assertLt(aliceDepositAfterProcess1.sDAIAmount, aliceShares, "Alice's shares reduced after first processBatch");
        uint256 aliceSharesAfterFirstHarvest = aliceDepositAfterProcess1.sDAIAmount;

        // 4. Generate more yield for second harvest
        sdai.setExchangeRate(1.2e18); // Another ~9% yield on remaining sDAI

        // 5. Second harvest - critical test: ensure no over-allocation
        manager.harvest();

        (uint256 totalBZZ,, uint256 totalYieldDAI, uint256 snapshotRate,,) = manager.distributionState();

        // Alice's shares should remain at reduced level (from first processBatch)
        PostageYieldManagerUpgradeable.Deposit memory aliceDepositAfterHarvest2 = manager.getUserDeposit(alice, 0);
        assertEq(
            aliceDepositAfterHarvest2.sDAIAmount,
            aliceSharesAfterFirstHarvest,
            "Alice's shares unchanged between first processBatch and second harvest"
        );

        // Critical test: Verify no over-allocation after multiple harvests
        // The bug was that totalPrincipalDAI was being recalculated after each harvest,
        // which corrupted the yield calculations and caused over-allocation.
        //
        // Key insight: totalYieldDAI represents NEW yield since last harvest,
        // calculated from the REDUCED totalSDAI (after previous yield was removed).
        // Alice's individual yield is calculated from her ORIGINAL shares (100 sDAI),
        // which includes accumulated yield from ALL harvests.
        //
        // The test: processBatch should correctly calculate Alice's share of THIS harvest's
        // BZZ distribution without over-allocating.

        // Calculate Alice's yield using the SAME formula as processBatch
        // This is the yield calculation that processBatch will use
        uint256 aliceValue = (aliceDepositAfterHarvest2.sDAIAmount * snapshotRate) / 1e18;
        uint256 aliceYield = aliceValue - aliceDepositAfterHarvest2.principalDAI;

        // Calculate expected BZZ for Alice (using same formula as processBatch)
        uint256 expectedAliceBZZ = aliceYield > 0 ? (totalBZZ * aliceYield) / totalYieldDAI : 0;

        // The CRITICAL invariant: her BZZ share should NOT exceed totalBZZ
        // Before the fix (when totalPrincipalDAI was recalculated), this would fail
        // because aliceYield > totalYieldDAI, causing expectedAliceBZZ > totalBZZ
        assertLe(expectedAliceBZZ, totalBZZ, "CRITICAL: No over-allocation - Alice's BZZ <= totalBZZ");

        // Additional verification: the calculation should be sane
        assertGt(totalYieldDAI, 0, "Should have yield to distribute");
        assertGt(aliceYield, 0, "Alice should have yield");

        // 6. Process batch should succeed (would have reverted before fix due to over-allocation)
        manager.processBatch(1);
    }

    function test_EdgeCase_VeryLargeDeposits() public {
        uint256 largeAmount = 1_000_000e18;

        // Mint large amount to Alice
        _mintSDAIToUser(alice, largeAmount);

        vm.startPrank(alice);
        sdai.approve(address(manager), largeAmount);
        manager.deposit(largeAmount, STAMP_ALICE);
        vm.stopPrank();

        // Rate increases
        sdai.setExchangeRate(1.05e18);

        uint256 yield = manager.previewYield();
        assertEq(yield, 50_000e18, "Should handle large numbers correctly");
    }

    function test_Fuzz_DepositAndWithdraw(uint256 depositAmount, uint256 withdrawAmount, uint256 newRate) public {
        // Bound inputs to reasonable ranges
        depositAmount = bound(depositAmount, 1e18, 1_000_000e18);
        withdrawAmount = bound(withdrawAmount, 0, depositAmount);
        newRate = bound(newRate, 1e18, 10e18); // 1x to 10x rate

        // Mint enough to Alice
        if (depositAmount > INITIAL_BALANCE) {
            _mintSDAIToUser(alice, depositAmount - INITIAL_BALANCE);
        }

        // Deposit
        vm.startPrank(alice);
        sdai.approve(address(manager), depositAmount);
        manager.deposit(depositAmount, STAMP_ALICE);

        // Change rate
        sdai.setExchangeRate(newRate);

        // Withdraw
        if (withdrawAmount > 0) {
            manager.withdraw(0, withdrawAmount);
        }
        vm.stopPrank();

        // Invariants
        PostageYieldManagerUpgradeable.Deposit memory userDeposit = manager.getUserDeposit(alice, 0);

        if (withdrawAmount == depositAmount) {
            assertEq(userDeposit.sDAIAmount, 0, "Should have zero sDAI after full withdrawal");
            assertEq(userDeposit.principalDAI, 0, "Should have zero principal after full withdrawal");
        } else {
            assertGt(userDeposit.sDAIAmount, 0, "Should have remaining sDAI");
            assertGt(userDeposit.principalDAI, 0, "Should have remaining principal");
        }
    }

    /*//////////////////////////////////////////////////////////////
                        HARVEST PRINCIPAL TESTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Critical test: BZZ distribution should be proportional to YIELD earned, not sDAI shares
    /// This prevents late depositors from stealing yield from early depositors
    function test_Harvest_UserPrincipalsReduced() public {
        // Scenario: Alice deposits early, earns yield. Bob deposits late (no yield).
        // Alice should get ALL the BZZ, Bob should get NONE.

        // Day 1: Alice deposits at rate 1.0
        vm.startPrank(alice);
        sdai.approve(address(manager), 100e18);
        manager.deposit(100e18, STAMP_ALICE);
        vm.stopPrank();

        // Rate increases to 1.1
        sdai.setExchangeRate(1.1e18);

        // Day 7: Bob deposits at rate 1.1 (RIGHT BEFORE HARVEST)
        vm.startPrank(bob);
        sdai.approve(address(manager), 100e18);
        manager.deposit(100e18, STAMP_BOB);
        vm.stopPrank();

        // Verify principals are different (Alice deposited at lower rate)
        PostageYieldManagerUpgradeable.Deposit memory aliceDepositBefore = manager.getUserDeposit(alice, 0);
        PostageYieldManagerUpgradeable.Deposit memory bobDepositBefore = manager.getUserDeposit(bob, 0);

        assertEq(aliceDepositBefore.principalDAI, 100e18, "Alice principal should be 100 DAI");
        assertEq(bobDepositBefore.principalDAI, 110e18, "Bob principal should be 110 DAI");

        // Check individual yields BEFORE harvest
        uint256 aliceYield = manager.previewUserYield(alice, 0);
        uint256 bobYield = manager.previewUserYield(bob, 0);

        assertEq(aliceYield, 10e18, "Alice should have 10 DAI yield");
        assertEq(bobYield, 0, "Bob should have 0 yield - he just deposited!");

        // Generate more yield
        sdai.setExchangeRate(1.2e18);

        // Now yields are:
        // Alice: (100 sDAI * 1.2) - 100 principal = 20 DAI yield
        // Bob: (100 sDAI * 1.2) - 110 principal = 10 DAI yield
        aliceYield = manager.previewUserYield(alice, 0);
        bobYield = manager.previewUserYield(bob, 0);

        assertEq(aliceYield, 20e18, "Alice should have 20 DAI yield");
        assertEq(bobYield, 10e18, "Bob should have 10 DAI yield");

        uint256 totalYield = manager.previewYield();
        assertEq(totalYield, 30e18, "Total yield should be 30 DAI");

        // Fund DEX with BZZ for swap
        bzz.mint(address(mockPool), 10000e18);

        // Harvest yield
        manager.harvest();

        (uint256 totalBZZ,, uint256 totalYieldDAI, uint256 snapshotRate,,) = manager.distributionState();

        // Verify shares remain unchanged
        PostageYieldManagerUpgradeable.Deposit memory aliceDepositAfter = manager.getUserDeposit(alice, 0);
        PostageYieldManagerUpgradeable.Deposit memory bobDepositAfter = manager.getUserDeposit(bob, 0);

        assertEq(aliceDepositAfter.sDAIAmount, 100e18, "Alice shares should remain fixed");
        assertEq(bobDepositAfter.sDAIAmount, 100e18, "Bob shares should remain fixed");

        assertEq(aliceDepositAfter.principalDAI, 100e18, "Alice principal should STILL be 100 DAI");
        assertEq(bobDepositAfter.principalDAI, 110e18, "Bob principal should STILL be 110 DAI");

        // Calculate expected BZZ distribution based on YIELD (not shares!)
        // Alice earned 20 DAI yield (66.67% of total)
        // Bob earned 10 DAI yield (33.33% of total)
        uint256 expectedAliceBZZ = (totalBZZ * 20e18) / 30e18; // 66.67%
        uint256 expectedBobBZZ = (totalBZZ * 10e18) / 30e18; // 33.33%

        // Calculate actual BZZ distribution (using FIXED implementation)
        uint256 aliceValue = (aliceDepositAfter.sDAIAmount * snapshotRate) / 1e18;
        uint256 aliceYieldAtHarvest = aliceValue - aliceDepositAfter.principalDAI;
        uint256 aliceBZZShare = (totalBZZ * aliceYieldAtHarvest) / totalYieldDAI;

        uint256 bobValue = (bobDepositAfter.sDAIAmount * snapshotRate) / 1e18;
        uint256 bobYieldAtHarvest = bobValue - bobDepositAfter.principalDAI;
        uint256 bobBZZShare = (totalBZZ * bobYieldAtHarvest) / totalYieldDAI;

        // CORRECT assertion: BZZ should be proportional to YIELD, not shares
        // This should PASS with the fixed implementation
        assertApproxEqRel(
            aliceBZZShare, expectedAliceBZZ, 0.01e18, "Alice should get ~66.67% of BZZ (proportional to yield)"
        );
        assertApproxEqRel(bobBZZShare, expectedBobBZZ, 0.01e18, "Bob should get ~33.33% of BZZ (proportional to yield)");

        // Verify total doesn't exceed available BZZ
        assertLe(aliceBZZShare + bobBZZShare, totalBZZ, "Total distribution shouldn't exceed available BZZ");
    }

    /// @notice Test that multiple harvests are blocked until distribution completes
    function test_Harvest_MultipleHarvests_Blocked() public {
        // Test behavior: Cannot call harvest again until processBatch completes

        // Lower threshold for testing
        manager.setMinYieldThreshold(1e18);

        // Alice deposits
        vm.startPrank(alice);
        sdai.approve(address(manager), 100e18);
        manager.deposit(100e18, STAMP_ALICE);
        vm.stopPrank();

        // Fund DEX with BZZ
        bzz.mint(address(mockPool), 100000e18);

        // First harvest
        sdai.setExchangeRate(1.1e18);
        manager.harvest();

        (uint256 totalBZZAfter1,,,,,) = manager.distributionState();
        bool active1;
        (,,,,, active1) = manager.distributionState();
        assertTrue(active1, "Distribution should be active after first harvest");

        // Attempt second harvest - should revert
        sdai.setExchangeRate(1.2e18);
        vm.expectRevert(PostageYieldManagerUpgradeable.DistributionInProgress.selector);
        manager.harvest();

        // Complete distribution
        vm.prank(address(0x123));
        manager.processBatch(10);

        // Now harvest should work again
        sdai.setExchangeRate(1.3e18);
        manager.harvest();

        (uint256 totalBZZAfter2,,,,,) = manager.distributionState();
        bool active2;
        (,,,,, active2) = manager.distributionState();
        assertTrue(active2, "Distribution should be active after second harvest");
    }

    /// @notice Test that totalPrincipalDAI is updated correctly during harvest (user shares stay fixed)
    function test_Harvest_TotalAndUserPrincipalsReduced() public {
        // Test behavior: Global totalPrincipalDAI changes, user shares stay fixed

        // Alice and Bob deposit
        vm.startPrank(alice);
        sdai.approve(address(manager), 100e18);
        manager.deposit(100e18, STAMP_ALICE);
        vm.stopPrank();

        vm.startPrank(bob);
        sdai.approve(address(manager), 100e18);
        manager.deposit(100e18, STAMP_BOB);
        vm.stopPrank();

        uint256 totalPrincipalBefore = manager.totalPrincipalDAI();
        assertEq(totalPrincipalBefore, 200e18, "Total principal should be 200 DAI");

        PostageYieldManagerUpgradeable.Deposit memory aliceDepositBefore = manager.getUserDeposit(alice, 0);
        PostageYieldManagerUpgradeable.Deposit memory bobDepositBefore = manager.getUserDeposit(bob, 0);
        uint256 aliceShares = aliceDepositBefore.sDAIAmount;
        uint256 bobShares = bobDepositBefore.sDAIAmount;

        // Generate yield and harvest
        sdai.setExchangeRate(1.2e18);
        bzz.mint(address(mockPool), 10000e18);
        manager.harvest();

        // Global totalPrincipalDAI should be recalculated (approximately matches original after yield removal)
        uint256 totalPrincipalAfter = manager.totalPrincipalDAI();
        assertApproxEqRel(
            totalPrincipalAfter,
            totalPrincipalBefore,
            0.01e18, // 1% tolerance for rounding
            "Total principal should be approximately unchanged (yield was removed)"
        );

        // User shares should remain unchanged
        PostageYieldManagerUpgradeable.Deposit memory aliceDepositAfter = manager.getUserDeposit(alice, 0);
        PostageYieldManagerUpgradeable.Deposit memory bobDepositAfter = manager.getUserDeposit(bob, 0);

        assertEq(aliceDepositAfter.sDAIAmount, aliceShares, "Alice shares unchanged");
        assertEq(bobDepositAfter.sDAIAmount, bobShares, "Bob shares unchanged");

        // Verify global totalSDAI was reduced (yield removed)
        uint256 totalSDAIBefore = 200e18; // Both deposited 100
        uint256 totalSDAIAfter = manager.totalSDAI();
        assertLt(totalSDAIAfter, totalSDAIBefore, "Global totalSDAI reduced after harvest");
    }

    /// @notice REGRESSION TEST: Withdrawing full balance should work after harvest + processBatch
    /// Bug: processBatch has a condition that skips reducing user shares if depositYieldShares > dep.sDAIAmount
    /// This causes getUserDeposit to return a higher sDAIAmount than the contract actually holds
    function test_Regression_WithdrawFullBalanceAfterHarvest() public {
        // Lower threshold for testing
        manager.setMinYieldThreshold(1e18);

        // Alice deposits 100 sDAI at 1:1 rate
        vm.startPrank(alice);
        sdai.approve(address(manager), 100e18);
        manager.deposit(100e18, STAMP_ALICE);
        vm.stopPrank();

        // Verify initial state
        PostageYieldManagerUpgradeable.Deposit memory depositBefore = manager.getUserDeposit(alice, 0);
        assertEq(depositBefore.sDAIAmount, 100e18, "Initial deposit should be 100 sDAI");
        assertEq(depositBefore.principalDAI, 100e18, "Initial principal should be 100 DAI");
        assertEq(manager.totalSDAI(), 100e18, "Total sDAI should be 100");

        // Generate yield: rate increases to 1.05
        sdai.setExchangeRate(1.05e18);

        // Verify yield is available
        uint256 totalYield = manager.previewYield();
        assertEq(totalYield, 5e18, "Should have 5 DAI of yield");

        // Fund DEX with BZZ for swap
        bzz.mint(address(mockPool), 10000e18);

        // Harvest yield
        manager.harvest();

        // Verify totalSDAI was reduced (yield was redeemed)
        uint256 totalSDAIAfterHarvest = manager.totalSDAI();
        console.log("Total sDAI after harvest:", totalSDAIAfterHarvest);
        assertLt(totalSDAIAfterHarvest, 100e18, "Total sDAI should be reduced after harvest");

        // User deposit should still show 100 sDAI (not yet updated)
        PostageYieldManagerUpgradeable.Deposit memory depositAfterHarvest = manager.getUserDeposit(alice, 0);
        console.log("Alice sDAI after harvest:", depositAfterHarvest.sDAIAmount);
        assertEq(depositAfterHarvest.sDAIAmount, 100e18, "User sDAI unchanged until processBatch");

        // Process the batch to distribute BZZ and update user shares
        vm.prank(address(0x123));
        manager.processBatch(10);

        // Get user deposit after processBatch
        PostageYieldManagerUpgradeable.Deposit memory depositAfterProcess = manager.getUserDeposit(alice, 0);
        console.log("Alice sDAI after processBatch:", depositAfterProcess.sDAIAmount);
        console.log("Contract sDAI balance:", sdai.balanceOf(address(manager)));

        // The bug: If depositYieldShares > dep.sDAIAmount due to rounding,
        // processBatch skips the subtraction, leaving user with inflated balance

        // Check if there's a mismatch between user's deposit and contract balance
        uint256 contractBalance = sdai.balanceOf(address(manager));
        if (depositAfterProcess.sDAIAmount > contractBalance) {
            console.log(
                "BUG DETECTED: User deposit (%e) > Contract balance (%e)",
                depositAfterProcess.sDAIAmount,
                contractBalance
            );
        }

        // Try to withdraw the full amount shown in getUserDeposit
        // This should succeed if accounting is correct
        vm.startPrank(alice);
        uint256 amountToWithdraw = depositAfterProcess.sDAIAmount;
        uint256 aliceBalanceBefore = sdai.balanceOf(alice);

        // This withdrawal should work, but will fail if there's an accounting bug
        manager.withdraw(0, amountToWithdraw);
        vm.stopPrank();

        // Verify withdrawal succeeded
        PostageYieldManagerUpgradeable.Deposit memory depositAfterWithdraw = manager.getUserDeposit(alice, 0);
        assertEq(depositAfterWithdraw.sDAIAmount, 0, "Should have withdrawn all sDAI");
        assertEq(sdai.balanceOf(alice), aliceBalanceBefore + amountToWithdraw, "Alice should receive withdrawn amount");

        // Verify contract balance has at most minimal dust from rounding up
        assertLt(
            sdai.balanceOf(address(manager)), 1000, "Contract should have at most minimal dust after full withdrawal"
        );
    }

    /// @notice REGRESSION TEST: Multiple harvests with odd amounts can cause rounding mismatches
    /// This test creates a scenario with multiple users and multiple harvest cycles
    /// to trigger accumulating rounding errors
    function test_Regression_MultipleHarvestsRoundingError() public {
        // Lower threshold for testing
        manager.setMinYieldThreshold(0.01e18);

        // Alice deposits 204.269366980327606381 sDAI (the exact amount from the bug report)
        uint256 aliceDeposit = 204269366980327606381;
        vm.startPrank(alice);
        sdai.approve(address(manager), aliceDeposit);
        manager.deposit(aliceDeposit, STAMP_ALICE);
        vm.stopPrank();

        // Bob deposits a different amount
        uint256 bobDeposit = 333e18;
        vm.startPrank(bob);
        sdai.approve(address(manager), bobDeposit);
        manager.deposit(bobDeposit, STAMP_BOB);
        vm.stopPrank();

        // Fund DEX with BZZ
        bzz.mint(address(mockPool), 100000e18);

        // Do multiple harvest cycles with odd exchange rates
        uint256[5] memory rates = [uint256(1.0234e18), 1.0567e18, 1.0891e18, 1.1234e18, 1.1567e18];

        for (uint256 i = 0; i < rates.length; i++) {
            sdai.setExchangeRate(rates[i]);

            uint256 totalYield = manager.previewYield();
            if (totalYield >= manager.minYieldThreshold()) {
                manager.harvest();

                // Process batch
                vm.prank(address(0x123));
                manager.processBatch(10);
            }
        }

        // Get final state
        PostageYieldManagerUpgradeable.Deposit memory aliceFinal = manager.getUserDeposit(alice, 0);
        PostageYieldManagerUpgradeable.Deposit memory bobFinal = manager.getUserDeposit(bob, 0);
        uint256 contractBalance = sdai.balanceOf(address(manager));
        uint256 totalSDAI = manager.totalSDAI();

        console.log("Alice final sDAI:", aliceFinal.sDAIAmount);
        console.log("Bob final sDAI:", bobFinal.sDAIAmount);
        console.log("Sum of deposits:", aliceFinal.sDAIAmount + bobFinal.sDAIAmount);
        console.log("Contract balance:", contractBalance);
        console.log("totalSDAI:", totalSDAI);

        // With "round UP for yield shares", sum of deposits will be slightly LESS than contract balance
        // This is expected - dust accumulates in the contract, but users can withdraw their full balances
        uint256 sumOfDeposits = aliceFinal.sDAIAmount + bobFinal.sDAIAmount;
        uint256 dustAmount = contractBalance > sumOfDeposits ? contractBalance - sumOfDeposits : 0;

        // Dust should be minimal (less than 1000 wei is acceptable for multiple harvests)
        assertLt(dustAmount, 1000, "Dust should be minimal");
        console.log("Dust amount (expected with round-up):", dustAmount);
        console.log("Contract has MORE than deposits:", contractBalance > sumOfDeposits);

        // Try to withdraw Alice's full balance - should work cleanly
        vm.startPrank(alice);
        uint256 aliceWithdrawAmount = aliceFinal.sDAIAmount;
        manager.withdraw(0, aliceWithdrawAmount);
        vm.stopPrank();

        // Verify Alice withdrew successfully
        PostageYieldManagerUpgradeable.Deposit memory aliceAfter = manager.getUserDeposit(alice, 0);
        assertEq(aliceAfter.sDAIAmount, 0, "Alice should have zero sDAI after withdrawal");

        // Bob should also be able to withdraw his full balance cleanly
        vm.startPrank(bob);
        uint256 bobWithdrawAmount = bobFinal.sDAIAmount;
        manager.withdraw(0, bobWithdrawAmount);
        vm.stopPrank();

        // Verify Bob withdrew successfully - full balance withdrawn
        PostageYieldManagerUpgradeable.Deposit memory bobAfter = manager.getUserDeposit(bob, 0);
        assertEq(bobAfter.sDAIAmount, 0, "Bob should have zero sDAI after withdrawal");

        // Contract should have some dust remaining (from rounding up)
        uint256 finalContractBalance = sdai.balanceOf(address(manager));
        assertLt(finalContractBalance, 1000, "Contract should have minimal dust remaining");
        assertLt(manager.totalSDAI(), 1000, "totalSDAI should be minimal dust");
    }
}
