// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {PostageYieldManager} from "../../src/PostageYieldManager.sol";
import {MockSavingsDai} from "../mocks/MockSavingsDai.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPostageStamp} from "../mocks/MockPostageStamp.sol";
import {MockDexRouter} from "../mocks/MockDexRouter.sol";

contract KeeperIncentivesTest is Test {
    PostageYieldManager public manager;
    MockSavingsDai public sdai;
    MockERC20 public dai;
    MockERC20 public bzz;
    MockPostageStamp public postageStamp;
    MockDexRouter public dexRouter;

    address public alice = address(0x1);
    address public bob = address(0x2);
    address public charlie = address(0x3);
    address public keeper1 = address(0x10);
    address public keeper2 = address(0x11);
    address public owner = address(this);

    bytes32 public constant STAMP_ALICE = bytes32(uint256(1));
    bytes32 public constant STAMP_BOB = bytes32(uint256(2));
    bytes32 public constant STAMP_CHARLIE = bytes32(uint256(3));

    uint256 public constant INITIAL_RATE = 1e18;
    uint256 public constant INITIAL_BALANCE = 1000e18;

    event BatchProcessed(address indexed keeper, uint256 usersProcessed, uint256 keeperReward);
    event DistributionComplete(uint256 totalBZZDistributed, uint256 totalUsersProcessed);
    event HarvesterFeePaid(address indexed harvester, uint256 amount);
    event HarvesterFeeUpdated(uint256 newFeeBps);

    function setUp() public {
        // Deploy mocks
        dai = new MockERC20("DAI", "DAI", 18);
        bzz = new MockERC20("BZZ", "BZZ", 18);
        sdai = new MockSavingsDai(address(dai), INITIAL_RATE);
        postageStamp = new MockPostageStamp();
        dexRouter = new MockDexRouter(address(dai), address(bzz));

        // Deploy manager
        manager = new PostageYieldManager(
            address(sdai),
            address(dai),
            address(bzz),
            address(postageStamp),
            address(dexRouter)
        );

        // Setup users with sDAI
        _mintSDAIToUser(alice, INITIAL_BALANCE);
        _mintSDAIToUser(bob, INITIAL_BALANCE);
        _mintSDAIToUser(charlie, INITIAL_BALANCE);

        // Create postage stamps
        postageStamp.createBatch(STAMP_ALICE);
        postageStamp.createBatch(STAMP_BOB);
        postageStamp.createBatch(STAMP_CHARLIE);

        // Give keepers some ETH for gas
        vm.deal(keeper1, 10 ether);
        vm.deal(keeper2, 10 ether);

        // Lower thresholds for testing
        manager.setMinYieldThreshold(1e18); // 1 DAI minimum
    }

    function _mintSDAIToUser(address user, uint256 amount) internal {
        dai.mint(user, amount);
        vm.startPrank(user);
        dai.approve(address(sdai), amount);
        sdai.deposit(amount, user);
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                        KEEPER FEE ALLOCATION TESTS
    //////////////////////////////////////////////////////////////*/

    function test_Harvest_AllocatesKeeperFees() public {
        // Setup: Users deposit
        vm.prank(alice);
        sdai.approve(address(manager), 100e18);
        vm.prank(alice);
        manager.deposit(100e18, STAMP_ALICE);

        vm.prank(bob);
        sdai.approve(address(manager), 200e18);
        vm.prank(bob);
        manager.deposit(200e18, STAMP_BOB);

        // Increase rate to generate yield
        sdai.setExchangeRate(1.2e18); // 20% yield

        // Harvest should allocate keeper fees
        uint256 yieldBefore = manager.previewYield();
        assertGt(yieldBefore, 0, "Should have yield");

        manager.harvest();

        // Check keeper fee pool was allocated (default 100 bps = 1%)
        uint256 keeperFeePool = manager.keeperFeePool();
        assertGt(keeperFeePool, 0, "Keeper fee pool should have funds");

        // Fee should be ~1% of yield
        uint256 expectedFee = (yieldBefore * 100) / 10000; // 1%
        assertApproxEqRel(keeperFeePool, expectedFee, 0.01e18, "Fee should be ~1% of yield");
    }

    function test_Harvest_CustomKeeperFeeBps() public {
        // Set keeper fee to 2%
        manager.setKeeperFee(200);

        vm.prank(alice);
        sdai.approve(address(manager), 100e18);
        vm.prank(alice);
        manager.deposit(100e18, STAMP_ALICE);

        sdai.setExchangeRate(1.1e18); // 10% yield

        manager.harvest();

        uint256 keeperFeePool = manager.keeperFeePool();
        uint256 expectedFee = (10e18 * 200) / 10000; // 2% of 10 DAI yield
        assertApproxEqRel(keeperFeePool, expectedFee, 0.01e18, "Fee should be ~2% of yield");
    }

    function test_Harvest_StartsDistribution() public {
        vm.prank(alice);
        sdai.approve(address(manager), 100e18);
        vm.prank(alice);
        manager.deposit(100e18, STAMP_ALICE);

        sdai.setExchangeRate(1.1e18);

        manager.harvest();

        (, , , bool active) = manager.distributionState();
        assertTrue(active, "Distribution should be active");
    }


    function test_MultipleHarvests_BeforeKeeperRuns() public {
        // Setup: Users deposit
        vm.prank(alice);
        sdai.approve(address(manager), 100e18);
        vm.prank(alice);
        manager.deposit(100e18, STAMP_ALICE);

        vm.prank(bob);
        sdai.approve(address(manager), 100e18);
        vm.prank(bob);
        manager.deposit(100e18, STAMP_BOB);

        // Fund DEX router with BZZ
        bzz.mint(address(dexRouter), 10000e18);

        // Increase rate to generate yield
        sdai.setExchangeRate(1.1e18); // 10% yield

        // First harvest - might not have enough keeper fees
        address harvester1 = address(0x100);
        vm.prank(harvester1);
        manager.harvest();

        // Check distribution is active
        (uint256 totalBZZ1, , , bool active1) = manager.distributionState();
        assertTrue(active1, "Distribution should be active after first harvest");
        uint256 keeperFeePool1 = manager.keeperFeePool();
        assertGt(keeperFeePool1, 0, "Keeper fee pool should have fees from first harvest");
        assertGt(totalBZZ1, 0, "Should have BZZ from first harvest");

        // generate more yield by increasing rate further
        sdai.setExchangeRate(1.2e18); // Additional yield: goes from 1.1 to 1.2

        // Second harvest BEFORE keeper runs - should accumulate fees
        address harvester2 = address(0x101);
        vm.prank(harvester2);
        manager.harvest();

        // Verify distribution is still active and BZZ accumulated
        (uint256 totalBZZ2, , , bool active2) = manager.distributionState();
        assertTrue(active2, "Distribution should still be active after second harvest");
        assertGt(totalBZZ2, totalBZZ1, "BZZ should accumulate from multiple harvests");

        uint256 keeperFeePool2 = manager.keeperFeePool();
        assertGt(keeperFeePool2, keeperFeePool1, "Keeper fees should accumulate");

        // Generate even more yield
        sdai.setExchangeRate(1.3e18); // More yield (continues increasing: 1.1 -> 1.2 -> 1.3)

        // Third harvest - further accumulation
        address harvester3 = address(0x102);
        vm.prank(harvester3);
        manager.harvest();

        (uint256 totalBZZ3, , , bool active3) = manager.distributionState();
        assertTrue(active3, "Distribution should still be active after third harvest");
        assertGt(totalBZZ3, totalBZZ2, "BZZ should further accumulate");

        uint256 keeperFeePool3 = manager.keeperFeePool();
        assertGt(keeperFeePool3, keeperFeePool2, "Keeper fees should further accumulate");

        // Now keeper runs with accumulated fees making it worthwhile
        vm.prank(keeper1);
        manager.processBatch(2);

        // Verify distribution completed
        (, , , bool active4) = manager.distributionState();
        assertFalse(active4, "Distribution should be complete");

        // Verify stamps received all accumulated BZZ
        uint256 aliceStampBalance = postageStamp.remainingBalance(STAMP_ALICE);
        uint256 bobStampBalance = postageStamp.remainingBalance(STAMP_BOB);

        // Each user should get 50% of total accumulated BZZ (they have equal deposits)
        uint256 expectedPerUser = totalBZZ3 / 2;
        assertApproxEqRel(aliceStampBalance, expectedPerUser, 0.01e18, "Alice stamp should receive correct BZZ");
        assertApproxEqRel(bobStampBalance, expectedPerUser, 0.01e18, "Bob stamp should receive correct BZZ");
    }


    /*//////////////////////////////////////////////////////////////
                        BATCH PROCESSING TESTS
    //////////////////////////////////////////////////////////////*/

    function test_ProcessBatch_BasicFunctionality() public {
        // Setup multiple users
        vm.prank(alice);
        sdai.approve(address(manager), 100e18);
        vm.prank(alice);
        manager.deposit(100e18, STAMP_ALICE);

        vm.prank(bob);
        sdai.approve(address(manager), 100e18);
        vm.prank(bob);
        manager.deposit(100e18, STAMP_BOB);

        // Generate yield and harvest
        sdai.setExchangeRate(1.2e18);
        manager.harvest();

        // Check keeper can process batch
        uint256 keeperBalanceBefore = dai.balanceOf(keeper1);

        vm.prank(keeper1);
        manager.processBatch(10); // Process up to 10 users

        uint256 keeperBalanceAfter = dai.balanceOf(keeper1);
        assertGt(keeperBalanceAfter, keeperBalanceBefore, "Keeper should receive DAI reward");
    }

    function test_ProcessBatch_RevertNoDistributionActive() public {
        vm.expectRevert(PostageYieldManager.NoDistributionActive.selector);
        vm.prank(keeper1);
        manager.processBatch(10);
    }

    function test_ProcessBatch_RevertInsufficientKeeperFees() public {
        // Temporarily set keeper fee to 0% so pool stays empty
        manager.setKeeperFee(0);

        vm.prank(alice);
        sdai.approve(address(manager), 100e18);
        vm.prank(alice);
        manager.deposit(100e18, STAMP_ALICE);

        sdai.setExchangeRate(1.2e18);
        manager.harvest();

        // Keeper fee pool should be 0 because we set fee to 0%
        assertEq(manager.keeperFeePool(), 0, "Keeper pool should be empty");

        vm.expectRevert(PostageYieldManager.InsufficientKeeperFees.selector);
        vm.prank(keeper1);
        manager.processBatch(10);
    }

    function test_ProcessBatch_MultipleKeepersCompete() public {
        // Setup 3 users
        vm.prank(alice);
        sdai.approve(address(manager), 100e18);
        vm.prank(alice);
        manager.deposit(100e18, STAMP_ALICE);

        vm.prank(bob);
        sdai.approve(address(manager), 100e18);
        vm.prank(bob);
        manager.deposit(100e18, STAMP_BOB);

        vm.prank(charlie);
        sdai.approve(address(manager), 100e18);
        vm.prank(charlie);
        manager.deposit(100e18, STAMP_CHARLIE);

        // Generate yield and harvest
        sdai.setExchangeRate(1.5e18); // 50% yield
        manager.harvest();

        // Keeper1 processes first batch
        uint256 keeper1BalanceBefore = dai.balanceOf(keeper1);
        vm.prank(keeper1);
        manager.processBatch(2); // Process 2 users
        uint256 keeper1BalanceAfter = dai.balanceOf(keeper1);
        assertGt(keeper1BalanceAfter, keeper1BalanceBefore, "Keeper1 should get paid");

        // Keeper2 processes remaining batch
        uint256 keeper2BalanceBefore = dai.balanceOf(keeper2);
        vm.prank(keeper2);
        manager.processBatch(2); // Process remaining user
        uint256 keeper2BalanceAfter = dai.balanceOf(keeper2);
        assertGt(keeper2BalanceAfter, keeper2BalanceBefore, "Keeper2 should get paid");

        // Both keepers got paid
        assertGt(keeper1BalanceAfter - keeper1BalanceBefore, 0, "Keeper1 earned fees");
        assertGt(keeper2BalanceAfter - keeper2BalanceBefore, 0, "Keeper2 earned fees");
    }

    function test_ProcessBatch_DistributionCompletes() public {
        vm.prank(alice);
        sdai.approve(address(manager), 100e18);
        vm.prank(alice);
        manager.deposit(100e18, STAMP_ALICE);

        sdai.setExchangeRate(1.2e18);
        manager.harvest();

        (, , , bool activeBefore) = manager.distributionState();
        assertTrue(activeBefore, "Distribution should be active before processing");

        // Process all users
        vm.prank(keeper1);
        manager.processBatch(100); // Large batch size to complete

        (, , , bool activeAfter) = manager.distributionState();
        assertFalse(activeAfter, "Distribution should be inactive after completion");
    }

    /*//////////////////////////////////////////////////////////////
                        BATCH INCENTIVE CALCULATION TESTS
    //////////////////////////////////////////////////////////////*/

    function test_GetBatchIncentive_ReturnsCorrectAmount() public {
        // Setup and harvest
        vm.prank(alice);
        sdai.approve(address(manager), 100e18);
        vm.prank(alice);
        manager.deposit(100e18, STAMP_ALICE);

        sdai.setExchangeRate(1.2e18);
        manager.harvest();

        uint256 keeperPool = manager.keeperFeePool();
        uint256 activeUserCount = manager.getActiveUserCount();

        // Get batch incentive for processing 1 user
        (bool canProcess, uint256 estimatedReward, uint256 remainingUsers) = manager.getBatchIncentive(1);

        assertTrue(canProcess, "Should be able to process");
        // Reward should be proportional: (pool * 1 user) / total users
        uint256 expectedReward = (keeperPool * 1) / activeUserCount;
        assertEq(estimatedReward, expectedReward, "Incentive should be proportional to work done");
        assertGt(remainingUsers, 0, "Should have users remaining");
    }

    function test_GetBatchIncentive_ZeroWhenNoDistribution() public {
        (bool canProcess, uint256 estimatedReward, ) = manager.getBatchIncentive(10);
        assertFalse(canProcess, "Should not be able to process");
        assertEq(estimatedReward, 0, "Incentive should be zero with no distribution");
    }

    function test_GetBatchIncentive_ZeroWhenInsufficientFees() public {
        // Set keeper fee to 0% so pool is empty
        manager.setKeeperFee(0);

        vm.prank(alice);
        sdai.approve(address(manager), 100e18);
        vm.prank(alice);
        manager.deposit(100e18, STAMP_ALICE);

        sdai.setExchangeRate(1.2e18);
        manager.harvest();

        // Keeper pool should be empty
        assertEq(manager.keeperFeePool(), 0, "Keeper pool should be empty");

        (bool canProcess, uint256 estimatedReward, ) = manager.getBatchIncentive(10);
        assertFalse(canProcess, "Should not be able to process");
        assertEq(estimatedReward, 0, "Incentive should be zero when insufficient fees");
    }

    /*//////////////////////////////////////////////////////////////
                        ACTIVE USER TRACKING TESTS
    //////////////////////////////////////////////////////////////*/

    function test_ActiveUsers_AddedOnDeposit() public {
        assertEq(manager.getActiveUserCount(), 0, "Should start with 0 users");

        vm.prank(alice);
        sdai.approve(address(manager), 100e18);
        vm.prank(alice);
        manager.deposit(100e18, STAMP_ALICE);

        assertEq(manager.getActiveUserCount(), 1, "Should have 1 active user");
        assertEq(manager.activeUsers(0), alice, "First user should be alice");
    }

    function test_ActiveUsers_NotDuplicatedOnMultipleDeposits() public {
        vm.prank(alice);
        sdai.approve(address(manager), 200e18);

        vm.prank(alice);
        manager.deposit(100e18, STAMP_ALICE);

        assertEq(manager.getActiveUserCount(), 1, "Should have 1 user after first deposit");

        vm.prank(alice);
        manager.deposit(100e18, STAMP_ALICE);

        assertEq(manager.getActiveUserCount(), 1, "Should still have 1 user after second deposit");
    }

    function test_ActiveUsers_RemovedOnFullWithdrawal() public {
        vm.prank(alice);
        sdai.approve(address(manager), 100e18);
        vm.prank(alice);
        manager.deposit(100e18, STAMP_ALICE);

        assertEq(manager.getActiveUserCount(), 1, "Should have 1 user");

        vm.prank(alice);
        manager.withdraw(0, 100e18);

        assertEq(manager.getActiveUserCount(), 0, "Should have 0 users after full withdrawal");
    }

    function test_ActiveUsers_NotRemovedOnPartialWithdrawal() public {
        vm.prank(alice);
        sdai.approve(address(manager), 100e18);
        vm.prank(alice);
        manager.deposit(100e18, STAMP_ALICE);

        vm.prank(alice);
        manager.withdraw(0, 50e18); // Withdraw half

        assertEq(manager.getActiveUserCount(), 1, "Should still have 1 user after partial withdrawal");
    }

    /*//////////////////////////////////////////////////////////////
                        ADMIN CONFIGURATION TESTS
    //////////////////////////////////////////////////////////////*/

    function test_SetKeeperFee_Success() public {
        manager.setKeeperFee(200); // 2%
        assertEq(manager.keeperFeeBps(), 200, "Keeper fee should be updated");
    }

    function test_SetKeeperFee_RevertTooHigh() public {
        vm.expectRevert(bytes("Fee too high"));
        manager.setKeeperFee(501); // > 5%
    }

    function test_SetKeeperFee_OnlyOwner() public {
        vm.expectRevert();
        vm.prank(alice);
        manager.setKeeperFee(200);
    }

    /*//////////////////////////////////////////////////////////////
                        INTEGRATION TESTS
    //////////////////////////////////////////////////////////////*/

    function test_FullKeeperWorkflow() public {
        // 1. Multiple users deposit
        vm.prank(alice);
        sdai.approve(address(manager), 100e18);
        vm.prank(alice);
        manager.deposit(100e18, STAMP_ALICE);

        vm.prank(bob);
        sdai.approve(address(manager), 200e18);
        vm.prank(bob);
        manager.deposit(200e18, STAMP_BOB);

        vm.prank(charlie);
        sdai.approve(address(manager), 150e18);
        vm.prank(charlie);
        manager.deposit(150e18, STAMP_CHARLIE);

        assertEq(manager.getActiveUserCount(), 3, "Should have 3 active users");

        // 2. Yield accrues
        sdai.setExchangeRate(1.3e18); // 30% yield

        uint256 yieldAmount = manager.previewYield();
        assertGt(yieldAmount, 0, "Should have yield");

        // 3. Harvest allocates fees and starts distribution
        manager.harvest();

        uint256 keeperFeePoolAfterHarvest = manager.keeperFeePool();
        assertGt(keeperFeePoolAfterHarvest, 0, "Keeper fee pool should have funds");

        (uint256 totalBZZ, , , bool active) = manager.distributionState();
        assertTrue(active, "Distribution should be active");
        assertGt(totalBZZ, 0, "Should have BZZ to distribute");

        // 4. Keeper processes batches
        uint256 keeper1InitialBalance = dai.balanceOf(keeper1);

        vm.prank(keeper1);
        manager.processBatch(2); // Process 2 users

        uint256 keeper1AfterBatch1 = dai.balanceOf(keeper1);
        assertGt(keeper1AfterBatch1, keeper1InitialBalance, "Keeper1 should earn fees");

        // 5. Another keeper processes remaining
        uint256 keeper2InitialBalance = dai.balanceOf(keeper2);

        vm.prank(keeper2);
        manager.processBatch(10); // Process remaining

        uint256 keeper2AfterBatch = dai.balanceOf(keeper2);
        assertGt(keeper2AfterBatch, keeper2InitialBalance, "Keeper2 should earn fees");

        // 6. Distribution should be complete
        (, , , bool stillActive) = manager.distributionState();
        assertFalse(stillActive, "Distribution should be complete");

        // 7. Verify BZZ was distributed to stamps
        uint256 aliceStampBalance = postageStamp.remainingBalance(STAMP_ALICE);
        uint256 bobStampBalance = postageStamp.remainingBalance(STAMP_BOB);
        uint256 charlieStampBalance = postageStamp.remainingBalance(STAMP_CHARLIE);

        assertGt(aliceStampBalance, 0, "Alice's stamp should receive BZZ");
        assertGt(bobStampBalance, 0, "Bob's stamp should receive BZZ");
        assertGt(charlieStampBalance, 0, "Charlie's stamp should receive BZZ");

        // Bob deposited 2x Alice, so should get ~2x BZZ
        assertApproxEqRel(bobStampBalance, aliceStampBalance * 2, 0.1e18, "Bob should get ~2x Alice");
    }

    function test_KeeperEconomics_WaitForProfitability() public {
        // Simulate keepers waiting for enough fees to accumulate
        manager.setMinYieldThreshold(0.1e18); // Lower threshold for this test

        // Initial deposit
        vm.prank(alice);
        sdai.approve(address(manager), 200e18);
        vm.prank(alice);
        manager.deposit(200e18, STAMP_ALICE);

        sdai.setExchangeRate(1.1e18); // 10% yield = 20 DAI, 1% fee = 0.2 DAI
        manager.harvest();

        uint256 feePoolAfterFirst = manager.keeperFeePool();
        assertGt(feePoolAfterFirst, 0, "Should have some fees");

        // Keeper processes the distribution (gets proportional reward)
        vm.prank(keeper1);
        manager.processBatch(10);

        // More users deposit over time
        vm.prank(bob);
        sdai.approve(address(manager), 300e18);
        vm.prank(bob);
        manager.deposit(300e18, STAMP_BOB);

        // Another harvest cycle with more yield
        sdai.setExchangeRate(1.2e18); // More yield
        manager.harvest();

        uint256 feePoolAfterSecond = manager.keeperFeePool();
        // Fee pool should have new fees even after paying keeper
        assertGt(feePoolAfterSecond, 0, "Fee pool should have new fees");
    }

    function test_Fuzz_KeeperBatchSizes(uint256 batchSize) public {
        batchSize = bound(batchSize, 1, 100);

        // Setup users
        vm.prank(alice);
        sdai.approve(address(manager), 100e18);
        vm.prank(alice);
        manager.deposit(100e18, STAMP_ALICE);

        vm.prank(bob);
        sdai.approve(address(manager), 100e18);
        vm.prank(bob);
        manager.deposit(100e18, STAMP_BOB);

        sdai.setExchangeRate(1.5e18);
        manager.harvest();

        // Process with random batch size
        vm.prank(keeper1);
        manager.processBatch(batchSize);

        // Should either complete or make progress
        (, uint256 cursor, , bool active) = manager.distributionState();

        if (!active) {
            // Distribution completed - state is deleted, so cursor will be 0
            assertEq(active, false, "Distribution should be complete");
            assertEq(cursor, 0, "Cursor should be reset after completion");
        } else {
            // Still active, cursor should have advanced
            assertGt(cursor, 0, "Cursor should have advanced");
            assertLe(cursor, manager.getActiveUserCount(), "Cursor should not exceed user count");
        }
    }

    /*//////////////////////////////////////////////////////////////
                        HARVESTER FEE TESTS
    //////////////////////////////////////////////////////////////*/

    function test_Harvest_PaysHarvesterFee() public {
        address harvester = address(0x99);

        // Setup: User deposits
        vm.prank(alice);
        sdai.approve(address(manager), 100e18);
        vm.prank(alice);
        manager.deposit(100e18, STAMP_ALICE);

        // Increase rate to generate yield
        sdai.setExchangeRate(1.2e18); // 20% yield = 20 DAI

        // Harvest as harvester
        uint256 harvesterBalanceBefore = dai.balanceOf(harvester);

        vm.prank(harvester);
        manager.harvest();

        uint256 harvesterBalanceAfter = dai.balanceOf(harvester);

        // Harvester should receive fee (default 50 bps = 0.5%)
        uint256 expectedFee = (20e18 * 50) / 10000; // 0.5% of 20 DAI = 0.1 DAI
        assertApproxEqRel(harvesterBalanceAfter - harvesterBalanceBefore, expectedFee, 0.01e18, "Harvester should receive ~0.5% fee");
    }

    function test_Harvest_EmitsHarvesterFeePaidEvent() public {
        address harvester = address(0x99);

        vm.prank(alice);
        sdai.approve(address(manager), 100e18);
        vm.prank(alice);
        manager.deposit(100e18, STAMP_ALICE);

        sdai.setExchangeRate(1.2e18); // 20% yield

        // Record logs to verify event emission
        vm.recordLogs();

        vm.prank(harvester);
        manager.harvest();

        // Get logs and verify HarvesterFeePaid was emitted
        Vm.Log[] memory entries = vm.getRecordedLogs();
        bool found = false;
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] == keccak256("HarvesterFeePaid(address,uint256)")) {
                found = true;
                assertEq(address(uint160(uint256(entries[i].topics[1]))), harvester, "Event should have correct harvester");
                break;
            }
        }
        assertTrue(found, "HarvesterFeePaid event should be emitted");
    }

    function test_Harvest_HarvesterFeeReducesBZZSwap() public {
        vm.prank(alice);
        sdai.approve(address(manager), 100e18);
        vm.prank(alice);
        manager.deposit(100e18, STAMP_ALICE);

        sdai.setExchangeRate(1.2e18); // 20% yield

        // Calculate expected amounts
        uint256 totalYield = 20e18;
        uint256 harvesterFee = (totalYield * 50) / 10000; // 0.5%
        uint256 keeperFee = (totalYield * 100) / 10000; // 1%
        uint256 daiToSwap = totalYield - harvesterFee - keeperFee;

        manager.harvest();

        // Check that distribution has the correct amount of BZZ
        // The mock router does 1:2 swap (1 DAI = 2 BZZ)
        uint256 expectedBZZ = daiToSwap * 2;
        (uint256 totalBZZ, , , ) = manager.distributionState();
        assertApproxEqRel(totalBZZ, expectedBZZ, 0.01e18, "BZZ amount should reflect both fee deductions");
    }

    function test_Harvest_CustomHarvesterFeeBps() public {
        address harvester = address(0x99);

        // Set harvester fee to 1% (100 bps)
        manager.setHarvesterFee(100);

        vm.prank(alice);
        sdai.approve(address(manager), 100e18);
        vm.prank(alice);
        manager.deposit(100e18, STAMP_ALICE);

        sdai.setExchangeRate(1.1e18); // 10% yield = 10 DAI

        uint256 harvesterBalanceBefore = dai.balanceOf(harvester);

        vm.prank(harvester);
        manager.harvest();

        uint256 harvesterBalanceAfter = dai.balanceOf(harvester);
        uint256 expectedFee = (10e18 * 100) / 10000; // 1% of 10 DAI = 0.1 DAI

        assertApproxEqRel(harvesterBalanceAfter - harvesterBalanceBefore, expectedFee, 0.01e18, "Fee should be ~1% of yield");
    }

    function test_Harvest_ZeroHarvesterFee() public {
        address harvester = address(0x99);

        // Set harvester fee to 0
        manager.setHarvesterFee(0);

        vm.prank(alice);
        sdai.approve(address(manager), 100e18);
        vm.prank(alice);
        manager.deposit(100e18, STAMP_ALICE);

        sdai.setExchangeRate(1.2e18); // 20% yield

        uint256 harvesterBalanceBefore = dai.balanceOf(harvester);

        vm.prank(harvester);
        manager.harvest();

        uint256 harvesterBalanceAfter = dai.balanceOf(harvester);

        assertEq(harvesterBalanceAfter, harvesterBalanceBefore, "Harvester should receive no fee when set to 0");
    }

    function test_Harvest_BothFeesDeductedCorrectly() public {
        address harvester = address(0x99);

        // Set specific fees for easier calculation
        manager.setHarvesterFee(100); // 1%
        manager.setKeeperFee(200); // 2%

        vm.prank(alice);
        sdai.approve(address(manager), 100e18);
        vm.prank(alice);
        manager.deposit(100e18, STAMP_ALICE);

        sdai.setExchangeRate(1.5e18); // 50% yield = 50 DAI

        uint256 harvesterBalanceBefore = dai.balanceOf(harvester);
        uint256 keeperFeePoolBefore = manager.keeperFeePool();

        vm.prank(harvester);
        manager.harvest();

        uint256 harvesterBalanceAfter = dai.balanceOf(harvester);
        uint256 keeperFeePoolAfter = manager.keeperFeePool();

        // Check harvester fee (1% of 50 DAI = 0.5 DAI)
        uint256 expectedHarvesterFee = (50e18 * 100) / 10000;
        assertApproxEqRel(harvesterBalanceAfter - harvesterBalanceBefore, expectedHarvesterFee, 0.01e18, "Harvester fee incorrect");

        // Check keeper fee (2% of 50 DAI = 1 DAI)
        uint256 expectedKeeperFee = (50e18 * 200) / 10000;
        assertApproxEqRel(keeperFeePoolAfter - keeperFeePoolBefore, expectedKeeperFee, 0.01e18, "Keeper fee incorrect");

        // Check BZZ amount (should be (50 - 0.5 - 1) * 2 = 97 DAI worth, because 1 DAI = 2 BZZ)
        uint256 expectedDaiToSwap = 50e18 - expectedHarvesterFee - expectedKeeperFee;
        uint256 expectedBZZ = expectedDaiToSwap * 2; // Mock router does 1:2 swap
        (uint256 totalBZZ, , , ) = manager.distributionState();
        assertApproxEqRel(totalBZZ, expectedBZZ, 0.01e18, "BZZ amount should reflect both fee deductions");
    }

    function test_SetHarvesterFee_Success() public {
        manager.setHarvesterFee(100); // 1%
        assertEq(manager.harvesterFeeBps(), 100, "Harvester fee should be updated");
    }

    function test_SetHarvesterFee_EmitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit HarvesterFeeUpdated(150);
        manager.setHarvesterFee(150);
    }

    function test_SetHarvesterFee_RevertTooHigh() public {
        vm.expectRevert(bytes("Fee too high"));
        manager.setHarvesterFee(201); // > 2%
    }

    function test_SetHarvesterFee_OnlyOwner() public {
        vm.expectRevert();
        vm.prank(alice);
        manager.setHarvesterFee(100);
    }

    function test_Harvest_MultipleHarvestersEarnFees() public {
        address harvester1 = address(0x98);
        address harvester2 = address(0x99);

        // Use larger deposit to ensure second harvest has enough yield
        vm.prank(alice);
        sdai.approve(address(manager), 500e18);
        vm.prank(alice);
        manager.deposit(500e18, STAMP_ALICE);

        // First harvest cycle
        sdai.setExchangeRate(1.1e18); // 10% yield = 50 DAI

        uint256 harvester1BalanceBefore = dai.balanceOf(harvester1);
        vm.prank(harvester1);
        manager.harvest();
        uint256 harvester1BalanceAfter = dai.balanceOf(harvester1);

        assertGt(harvester1BalanceAfter, harvester1BalanceBefore, "Harvester1 should earn fee");

        // Complete distribution
        vm.prank(keeper1);
        manager.processBatch(10);

        // Second harvest cycle - increase rate significantly
        sdai.setExchangeRate(1.3e18); // Further rate increase to generate new yield

        uint256 harvester2BalanceBefore = dai.balanceOf(harvester2);
        vm.prank(harvester2);
        manager.harvest();
        uint256 harvester2BalanceAfter = dai.balanceOf(harvester2);

        assertGt(harvester2BalanceAfter, harvester2BalanceBefore, "Harvester2 should earn fee");
    }
}
