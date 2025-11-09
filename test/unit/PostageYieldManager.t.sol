// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {PostageYieldManager} from "../../src/PostageYieldManager.sol";
import {MockSavingsDai} from "../mocks/MockSavingsDai.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPostageStamp} from "../mocks/MockPostageStamp.sol";
import {MockDexRouter} from "../mocks/MockDexRouter.sol";

contract PostageYieldManagerTest is Test {
    PostageYieldManager public manager;
    MockSavingsDai public sdai;
    MockERC20 public dai;
    MockERC20 public bzz;
    MockPostageStamp public postageStamp;
    MockDexRouter public dexRouter;

    address public alice = address(0x1);
    address public bob = address(0x2);
    address public charlie = address(0x3);

    bytes32 public constant STAMP_ALICE = bytes32(uint256(1));
    bytes32 public constant STAMP_BOB = bytes32(uint256(2));
    bytes32 public constant STAMP_CHARLIE = bytes32(uint256(3));

    uint256 public constant INITIAL_RATE = 1e18; // 1:1 sDAI:DAI
    uint256 public constant INITIAL_BALANCE = 1000e18;

    function setUp() public {
        // Deploy mocks
        dai = new MockERC20("DAI", "DAI", 18);
        bzz = new MockERC20("BZZ", "BZZ", 18);
        sdai = new MockSavingsDai(address(dai), INITIAL_RATE);
        postageStamp = new MockPostageStamp();
        dexRouter = new MockDexRouter(address(dai), address(bzz));

        // Deploy manager
        manager = new PostageYieldManager(
            address(sdai), address(dai), address(bzz), address(postageStamp), address(dexRouter)
        );

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

        PostageYieldManager.Deposit memory userDeposit = manager.getUserDeposit(alice, 0);

        assertEq(userDeposit.sDAIAmount, depositAmount, "Deposit sDAI amount mismatch");
        assertEq(userDeposit.principalDAI, depositAmount, "Principal DAI should equal deposit at 1:1 rate");
        assertEq(userDeposit.stampId, STAMP_ALICE, "Stamp ID mismatch");
        assertGt(userDeposit.depositTime, 0, "Deposit time should be set");
    }

    function test_Deposit_RevertZeroAmount() public {
        vm.startPrank(alice);
        sdai.approve(address(manager), 100e18);
        vm.expectRevert(PostageYieldManager.ZeroAmount.selector);
        manager.deposit(0, STAMP_ALICE);
        vm.stopPrank();
    }

    function test_Deposit_RevertZeroStampId() public {
        vm.startPrank(alice);
        sdai.approve(address(manager), 100e18);
        vm.expectRevert(PostageYieldManager.InvalidStampId.selector);
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
        PostageYieldManager.Deposit memory aliceDepositData = manager.getUserDeposit(alice, 0);
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
        PostageYieldManager.Deposit memory bobDepositData = manager.getUserDeposit(bob, 0);
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

        PostageYieldManager.Deposit memory userDeposit = manager.getUserDeposit(alice, 0);
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
        PostageYieldManager.Deposit memory userDeposit = manager.getUserDeposit(alice, 0);
        assertEq(userDeposit.principalDAI, 75e18, "Principal should reduce proportionally");
    }

    function test_Withdraw_RevertInsufficientBalance() public {
        vm.startPrank(alice);
        sdai.approve(address(manager), 100e18);
        manager.deposit(100e18, STAMP_ALICE);

        vm.expectRevert(PostageYieldManager.InsufficientBalance.selector);
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

        PostageYieldManager.Deposit memory userDeposit = manager.getUserDeposit(alice, 0);
        assertEq(userDeposit.stampId, newStampId, "Stamp ID should be updated");
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
        PostageYieldManager.Deposit memory userDeposit = manager.getUserDeposit(alice, 0);

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

    /// @notice Critical test: User principals must NOT be reduced when yield is harvested
    /// Only withdrawals should reduce user principals
    function test_Harvest_UserPrincipalsUnchanged() public {
        // Setup: Two users deposit at different rates
        vm.startPrank(alice);
        sdai.approve(address(manager), 100e18);
        manager.deposit(100e18, STAMP_ALICE);
        vm.stopPrank();

        // Rate increases
        sdai.setExchangeRate(1.1e18);

        vm.startPrank(bob);
        sdai.approve(address(manager), 100e18);
        manager.deposit(100e18, STAMP_BOB);
        vm.stopPrank();

        // Record user principals before harvest
        PostageYieldManager.Deposit memory aliceDepositBefore = manager.getUserDeposit(alice, 0);
        PostageYieldManager.Deposit memory bobDepositBefore = manager.getUserDeposit(bob, 0);
        uint256 alicePrincipalBefore = aliceDepositBefore.principalDAI;
        uint256 bobPrincipalBefore = bobDepositBefore.principalDAI;
        uint256 aliceSDaiBefore = aliceDepositBefore.sDAIAmount;
        uint256 bobSDaiBefore = bobDepositBefore.sDAIAmount;

        assertEq(alicePrincipalBefore, 100e18, "Alice principal should be 100 DAI");
        assertEq(bobPrincipalBefore, 110e18, "Bob principal should be 110 DAI");

        // Generate more yield
        sdai.setExchangeRate(1.2e18);

        // Fund DEX with BZZ for swap
        bzz.mint(address(dexRouter), 10000e18);

        // Harvest yield
        manager.harvest();

        // Verify user principals are UNCHANGED after harvest
        PostageYieldManager.Deposit memory aliceDepositAfter = manager.getUserDeposit(alice, 0);
        PostageYieldManager.Deposit memory bobDepositAfter = manager.getUserDeposit(bob, 0);

        assertEq(
            aliceDepositAfter.principalDAI, alicePrincipalBefore, "Alice principal should NOT change after harvest"
        );
        assertEq(bobDepositAfter.principalDAI, bobPrincipalBefore, "Bob principal should NOT change after harvest");
        assertEq(aliceDepositAfter.sDAIAmount, aliceSDaiBefore, "Alice sDAI amount should NOT change after harvest");
        assertEq(bobDepositAfter.sDAIAmount, bobSDaiBefore, "Bob sDAI amount should NOT change after harvest");
    }

    /// @notice Test multiple harvests don't affect user principals
    function test_Harvest_MultipleHarvests_UserPrincipalsUnchanged() public {
        // Lower threshold for testing
        manager.setMinYieldThreshold(1e18);

        // Alice deposits
        vm.startPrank(alice);
        sdai.approve(address(manager), 100e18);
        manager.deposit(100e18, STAMP_ALICE);
        vm.stopPrank();

        // Record initial principal
        PostageYieldManager.Deposit memory aliceDepositInitial = manager.getUserDeposit(alice, 0);
        uint256 alicePrincipalInitial = aliceDepositInitial.principalDAI;
        uint256 aliceSDaiInitial = aliceDepositInitial.sDAIAmount;

        // Fund DEX with BZZ
        bzz.mint(address(dexRouter), 100000e18);

        // First harvest
        sdai.setExchangeRate(1.1e18);
        manager.harvest();

        PostageYieldManager.Deposit memory aliceDepositAfterHarvest1 = manager.getUserDeposit(alice, 0);
        assertEq(aliceDepositAfterHarvest1.principalDAI, alicePrincipalInitial, "Principal unchanged after 1st harvest");
        assertEq(aliceDepositAfterHarvest1.sDAIAmount, aliceSDaiInitial, "sDAI amount unchanged after 1st harvest");

        // Second harvest (before keeper processes)
        sdai.setExchangeRate(1.2e18);
        manager.harvest();

        PostageYieldManager.Deposit memory aliceDepositAfterHarvest2 = manager.getUserDeposit(alice, 0);
        assertEq(aliceDepositAfterHarvest2.principalDAI, alicePrincipalInitial, "Principal unchanged after 2nd harvest");
        assertEq(aliceDepositAfterHarvest2.sDAIAmount, aliceSDaiInitial, "sDAI amount unchanged after 2nd harvest");

        // Third harvest
        sdai.setExchangeRate(1.3e18);
        manager.harvest();

        PostageYieldManager.Deposit memory aliceDepositAfterHarvest3 = manager.getUserDeposit(alice, 0);
        assertEq(aliceDepositAfterHarvest3.principalDAI, alicePrincipalInitial, "Principal unchanged after 3rd harvest");
        assertEq(aliceDepositAfterHarvest3.sDAIAmount, aliceSDaiInitial, "sDAI amount unchanged after 3rd harvest");

        // Process distribution - still shouldn't affect principals
        vm.prank(address(0x123));
        manager.processBatch(10);

        PostageYieldManager.Deposit memory aliceDepositAfterDistribution = manager.getUserDeposit(alice, 0);
        assertEq(
            aliceDepositAfterDistribution.principalDAI, alicePrincipalInitial, "Principal unchanged after distribution"
        );
        assertEq(aliceDepositAfterDistribution.sDAIAmount, aliceSDaiInitial, "sDAI amount unchanged after distribution");
    }

    /// @notice Test that totalPrincipalDAI is updated correctly during harvest but user principals are not
    function test_Harvest_TotalPrincipalUpdated_UserPrincipalsUnchanged() public {
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

        PostageYieldManager.Deposit memory aliceDepositBefore = manager.getUserDeposit(alice, 0);
        PostageYieldManager.Deposit memory bobDepositBefore = manager.getUserDeposit(bob, 0);

        // Generate yield and harvest
        sdai.setExchangeRate(1.2e18);
        bzz.mint(address(dexRouter), 10000e18);
        manager.harvest();

        // totalPrincipalDAI should be recalculated to match the current value of remaining sDAI
        // After harvesting yield, remaining value should approximately equal original principal
        uint256 totalPrincipalAfter = manager.totalPrincipalDAI();
        assertApproxEqRel(
            totalPrincipalAfter,
            totalPrincipalBefore,
            0.001e18, // 0.1% tolerance for rounding
            "Total principal should be approximately unchanged (yield was removed)"
        );

        // But individual user principals should be UNCHANGED
        PostageYieldManager.Deposit memory aliceDepositAfter = manager.getUserDeposit(alice, 0);
        PostageYieldManager.Deposit memory bobDepositAfter = manager.getUserDeposit(bob, 0);

        assertEq(aliceDepositAfter.principalDAI, aliceDepositBefore.principalDAI, "Alice principal unchanged");
        assertEq(bobDepositAfter.principalDAI, bobDepositBefore.principalDAI, "Bob principal unchanged");

        // User principals sum should still be the original 200 DAI
        uint256 userPrincipalSum = aliceDepositAfter.principalDAI + bobDepositAfter.principalDAI;
        assertEq(userPrincipalSum, 200e18, "Sum of user principals should remain 200 DAI");
    }
}
