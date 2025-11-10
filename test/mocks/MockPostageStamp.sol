// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Mock Swarm Postage Stamp contract for testing
contract MockPostageStamp {
    mapping(bytes32 => uint256) public batchBalances;
    mapping(bytes32 => bool) public batchExists;
    mapping(bytes32 => uint8) public batchDepths;

    event BatchCreated(bytes32 indexed batchId);
    event BatchToppedUp(bytes32 indexed batchId, uint256 amount);

    /// @notice Create a new batch (for testing)
    function createBatch(bytes32 batchId) external {
        createBatchWithDepth(batchId, 17); // Default depth of 17 for realistic testing (batch size = 131,072)
    }

    /// @notice Create a new batch with specific depth (for testing)
    function createBatchWithDepth(bytes32 batchId, uint8 depth) public {
        batchExists[batchId] = true;
        batchDepths[batchId] = depth;
        emit BatchCreated(batchId);
    }

    /// @notice Top up a postage batch
    /// @param batchId The batch ID to top up
    /// @param topupAmountPerChunk Amount to add per chunk (like the real Swarm contract)
    /// @dev Mimics real Swarm behavior: totalAmount = topupAmountPerChunk * 2^depth
    function topUp(bytes32 batchId, uint256 topupAmountPerChunk) external {
        require(batchExists[batchId], "Batch does not exist");
        uint256 batchSize = 1 << batchDepths[batchId]; // 2^depth
        uint256 totalAmount = topupAmountPerChunk * batchSize;
        batchBalances[batchId] += totalAmount;
        emit BatchToppedUp(batchId, totalAmount);
    }

    /// @notice Get remaining balance
    function remainingBalance(bytes32 batchId) external view returns (uint256) {
        return batchBalances[batchId];
    }

    /// @notice Get batch depth
    function batchDepth(bytes32 batchId) external view returns (uint8) {
        require(batchExists[batchId], "Batch does not exist");
        return batchDepths[batchId];
    }
}
